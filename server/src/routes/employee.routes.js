import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { can, canOrOutletManager } from '../lib/capabilities.js';
import { outletScope, outletInclude, GLOBAL_SCOPE_ROLES } from '../lib/scope.js';
import { generateTemporaryPassword } from '../lib/passwords.js';
import { logAudit } from '../lib/audit.js';

const router = Router();

/**
 * SUPER_ADMIN, ADMIN and HR are organisation-wide: no outlet, no department, no
 * stations. Reusing GLOBAL_SCOPE_ROLES rather than restating the list keeps this
 * in step with the scoping rule it follows from — those are exactly the roles
 * outletScope() refuses to pin to an outlet.
 */
const isManagementRole = (role) => GLOBAL_SCOPE_ROLES.includes(role);

/**
 * The assignment fields for a role. Returns `{ data }` or `{ error }`.
 *
 * Applied on both create and update so the two cannot drift — promoting a head
 * chef to HR has to clear the outlet they no longer belong to, and demoting an
 * HR back has to insist on one.
 */
function readAssignment(role, { outletId, department, skills }, existing = {}) {
  if (isManagementRole(role)) {
    // Cleared rather than ignored: a promotion must not leave the old outlet
    // behind, still counting against that restaurant's headcount.
    return { data: { outletId: null, department: null, skills: [] } };
  }

  const nextOutlet = outletId !== undefined ? outletId : existing.outletId;
  if (!nextOutlet) return { error: 'outletId is required for this role' };

  // An Outlet Manager oversees the whole restaurant, not one department —
  // no department or stations to assign, unlike Head Chef/Master of
  // House/Staff, who each work one.
  if (role === 'OUTLET_MANAGER') {
    return { data: { outletId: nextOutlet, department: null, skills: [] } };
  }

  const nextDepartment = department !== undefined ? department : existing.department;
  if (!nextDepartment) return { error: 'department is required for this role' };

  return {
    data: {
      outletId: nextOutlet,
      department: nextDepartment,
      skills: readStations(skills !== undefined ? skills : existing.skills, nextDepartment),
    },
  };
}

/**
 * HR/ADMIN/SUPER_ADMIN may assign any role to any outlet. An OUTLET_MANAGER
 * may only manage staff at their own outlet, and only into an outlet-level
 * role — not a global role or another Outlet Manager, mirroring the
 * HR-cannot-assign-management-roles rule below. Returns an error string, or
 * null when the write is allowed.
 */
function outletManagerAssignmentDenied(req, { outletId, role }) {
  if (req.user.role !== 'OUTLET_MANAGER') return null;
  if (outletId !== req.user.outletId) {
    return 'You can only manage employees at your own outlet';
  }
  if (GLOBAL_SCOPE_ROLES.includes(role) || role === 'OUTLET_MANAGER') {
    return 'You cannot assign that role';
  }
  return null;
}

// GET /api/employees — list all employees (with filters)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { department, role, search, page = 1, limit = 50 } = req.query;

    // outletScope() resolves ?org/?brand/?outlet and pins non-global roles to
    // their own outlet, so it must be spread last.
    const where = { isActive: true, ...outletScope(req) };

    if (department) where.department = department;
    if (role) where.role = role;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        include: outletInclude,
        skip: (page - 1) * limit,
        take: parseInt(limit),
        orderBy: { name: 'asc' },
      }),
      prisma.employee.count({ where }),
    ]);

    // Remove passwords from response
    const sanitized = employees.map(({ password, ...emp }) => emp);

    res.json({ employees: sanitized, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/employees/:id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: {
        ...outletInclude,
        shifts: { orderBy: { date: 'desc' }, take: 20 },
        attendance: { orderBy: { date: 'desc' }, take: 30 },
        leaves: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });

    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const { password, ...sanitized } = employee;
    res.json(sanitized);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Stations an employee works, stored on `skills`.
 *
 * Lowercased because that is what the allocator compares against —
 * `scoreEmployee` tests `employee.skills.includes(slot.section.toLowerCase())`,
 * so a capitalised value stores fine and then silently never matches. Blanks
 * dropped and duplicates collapsed, because a station listed twice is still one
 * station.
 *
 * Non-kitchen staff get none: stations are a kitchen concept, and only kitchen
 * shifts carry a section to match against.
 */
function readStations(skills, department) {
  if (department && department !== 'KITCHEN') return [];
  if (!Array.isArray(skills)) return [];
  return [...new Set(
    skills.map((s) => String(s).trim().toLowerCase()).filter(Boolean)
  )];
}

// POST /api/employees — create employee
router.post('/', authenticateToken, can('EMPLOYEE_CREATE'), async (req, res) => {
  try {
    const { name, email, phone, role, department, outletId, skills } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!email) {
      return res.status(400).json({ error: 'email is required — it is how they sign in' });
    }

    // Which fields are even asked for depends on the role: an HR account has no
    // outlet or department to give, and demanding them was why the super admin
    // ended up claiming a restaurant it had nothing to do with.
    const effectiveRole = role || 'STAFF';

    if (req.user.role === 'HR' && GLOBAL_SCOPE_ROLES.includes(effectiveRole)) {
      return res.status(403).json({ error: 'HR cannot assign management roles' });
    }

    const { data: assignment, error } = readAssignment(effectiveRole, { outletId, department, skills });
    if (error) return res.status(400).json({ error });

    const denied = outletManagerAssignmentDenied(req, { outletId: assignment.outletId, role: effectiveRole });
    if (denied) return res.status(403).json({ error: denied });

    // Generated here, never supplied. The old `password || 'shiftly123'` meant
    // every account in the system shared one password that nobody could change.
    const temporaryPassword = generateTemporaryPassword();

    const employee = await prisma.employee.create({
      data: {
        name,
        email,
        phone,
        role: effectiveRole,
        ...assignment,
        password: await bcrypt.hash(temporaryPassword, 10),
        mustChangePassword: true,
      },
      include: outletInclude,
    });

    const { password: _, ...sanitized } = employee;

    logAudit({ action: 'EMPLOYEE_CREATE', entity: 'Employee', entityId: employee.id, actor: req.user, details: { employeeName: name, role: effectiveRole } });

    res.status(201).json({ ...sanitized, temporaryPassword });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/employees/:id
router.put('/:id', authenticateToken, can('EMPLOYEE_EDIT'), async (req, res) => {
  try {
    const { name, email, phone, role, department, outletId, skills, isActive } = req.body;

    const existing = await prisma.employee.findUnique({
      where: { id: req.params.id },
      select: { role: true, department: true, outletId: true, skills: true },
    });
    if (!existing) return res.status(404).json({ error: 'Employee not found' });

    const data = {};
    if (name !== undefined) data.name = name;
    if (email !== undefined) data.email = email;
    if (phone !== undefined) data.phone = phone;
    if (role !== undefined) data.role = role;
    if (isActive !== undefined) data.isActive = isActive;

    // Judged against the *effective* role, because this handler is partial: a
    // request that changes only the role still has to move the assignment with
    // it — promoting a head chef to HR clears the outlet, and demoting an HR
    // back has to be given one rather than silently landing nowhere.
    const effectiveRole = role ?? existing.role;

    if (req.user.role === 'HR' && GLOBAL_SCOPE_ROLES.includes(effectiveRole)) {
      return res.status(403).json({ error: 'HR cannot assign management roles' });
    }

    const { data: assignment, error } = readAssignment(
      effectiveRole, { outletId, department, skills }, existing
    );
    if (error) return res.status(400).json({ error });

    const denied = outletManagerAssignmentDenied(req, { outletId: assignment.outletId, role: effectiveRole })
      || outletManagerAssignmentDenied(req, { outletId: existing.outletId, role: existing.role });
    if (denied) return res.status(403).json({ error: denied });

    Object.assign(data, assignment);

    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data,
      include: outletInclude,
    });

    const { password, ...sanitized } = employee;

    logAudit({ action: 'EMPLOYEE_EDIT', entity: 'Employee', entityId: employee.id, actor: req.user, details: { employeeName: employee.name } });

    res.json(sanitized);
  } catch (err) {
    // Both were mapped on POST but not here, so renaming onto a taken email or
    // editing a row deleted underneath you surfaced as a bare 500.
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/employees/:id/reset-password
 *
 * Issues a fresh one-time password and re-arms the forced change, for the
 * everyday case of somebody locked out. The value is returned exactly once —
 * what is stored is a hash, so there is no way to look it up again.
 */
router.post('/:id/reset-password', authenticateToken, canOrOutletManager('EMPLOYEE_RESET_PW'), async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, email: true, role: true, outletId: true },
    });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const denied = outletManagerAssignmentDenied(req, { outletId: employee.outletId, role: employee.role });
    if (denied) return res.status(403).json({ error: denied });

    const temporaryPassword = generateTemporaryPassword();
    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        password: await bcrypt.hash(temporaryPassword, 10),
        mustChangePassword: true,
      },
    });

    res.json({ id: employee.id, name: employee.name, email: employee.email, temporaryPassword });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/employees/:id (soft delete)
//
// Deactivation is a real lockout: the login handler refuses an inactive
// account. Not a hard delete — that would permanently erase the employee's
// shift/attendance/leave history (retroactively changing dashboard numbers
// for weeks that already happened) and would need a foreign-key cascade
// through TransferRequest as well. Bulk removal at that scope already exists,
// gated at SUPER_ADMIN with a typed confirmation (see wipe-staff below); this
// single-employee action stays reversible and ADMIN-level.
router.delete('/:id', authenticateToken, canOrOutletManager('EMPLOYEE_DEACTIVATE'), async (req, res) => {
  try {
    const id = req.params.id;

    const target = await prisma.employee.findUnique({
      where: { id },
      select: { role: true, outletId: true },
    });
    if (!target) return res.status(404).json({ error: 'Employee not found' });
    const denied = outletManagerAssignmentDenied(req, { outletId: target.outletId, role: target.role });
    if (denied) return res.status(403).json({ error: denied });

    const employee = await prisma.employee.update({
      where: { id },
      data: { isActive: false },
    });
    logAudit({ action: 'EMPLOYEE_DEACTIVATE', entity: 'Employee', entityId: id, actor: req.user, details: { employeeName: employee.name } });

    res.json({ message: 'Employee deactivated' });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * Bulk staff wipe — SUPER_ADMIN only.
 *
 * Scope is deliberately STAFF-only. Deleting every employee would remove the
 * caller's own row while their JWT stayed valid, so every subsequent request
 * would 500 and nobody could sign back in without terminal access. Keeping the
 * 15 management accounts also preserves the rule that each outlet has a Master
 * of House and a Head Chef.
 *
 * Guarded by STAFF_WIPE, whose floor is SUPER_ADMIN. That used to be an exact
 * `requireRole('SUPER_ADMIN')`, to say "only this role" — identical today, since
 * SUPER_ADMIN tops ROLE_HIERARCHY. Adding a role above it would widen this, so
 * that is the moment to reach for an exact match again.
 */
const WIPE_CONFIRMATION = 'DELETE ALL STAFF';

/** The employees a wipe targets. Used by both the preview and the wipe itself. */
const wipeTarget = (req) => ({ role: 'STAFF', id: { not: req.user.id } });

// GET /api/employees/stats/wipe-preview
//
// Two path segments on purpose: a single-segment literal such as /wipe-preview
// would be captured by `router.get('/:id')` above and looked up as an employee.
router.get('/stats/wipe-preview', authenticateToken, can('STAFF_WIPE_PREVIEW'), async (req, res) => {
  try {
    const targets = await prisma.employee.findMany({
      where: wipeTarget(req),
      select: { id: true },
    });
    const employeeId = { in: targets.map((t) => t.id) };

    const [shifts, attendance, leaves, notifications, keeping] = await Promise.all([
      prisma.shift.count({ where: { employeeId } }),
      prisma.attendance.count({ where: { employeeId } }),
      prisma.leave.count({ where: { employeeId } }),
      prisma.notification.count({ where: { employeeId } }),
      prisma.employee.count({ where: { role: { not: 'STAFF' } } }),
    ]);

    res.json({ employees: targets.length, shifts, attendance, leaves, notifications, keeping });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/employees/wipe-staff
//
// POST, not DELETE, because the API client's delete() sends no body and this
// requires a typed confirmation.
router.post('/wipe-staff', authenticateToken, can('STAFF_WIPE'), async (req, res) => {
  try {
    if (req.body?.confirm !== WIPE_CONFIRMATION) {
      return res.status(400).json({
        error: `Confirmation phrase required. Send { "confirm": "${WIPE_CONFIRMATION}" }.`,
      });
    }

    // One interactive transaction so the id lookup and all five deletes commit
    // together. No relation in the schema declares onDelete, so every foreign key
    // to Employee defaults to Restrict — children must go first, and a failure
    // part-way through must roll back rather than leave a half-wiped database.
    const result = await prisma.$transaction(async (tx) => {
      const targets = await tx.employee.findMany({
        where: wipeTarget(req),
        select: { id: true },
      });
      const employeeId = { in: targets.map((t) => t.id) };

      const notifications = await tx.notification.deleteMany({ where: { employeeId } });
      const attendance = await tx.attendance.deleteMany({ where: { employeeId } });
      const leaves = await tx.leave.deleteMany({ where: { employeeId } });
      const shifts = await tx.shift.deleteMany({ where: { employeeId } });
      // TransferRequest.employee is a required relation with no onDelete
      // clause, so it defaults to Restrict — any staff member who ever
      // submitted a transfer request would otherwise abort this whole
      // transaction with a foreign-key violation.
      await tx.transferRequest.deleteMany({ where: { employeeId } });
      const employees = await tx.employee.deleteMany({ where: { id: employeeId } });

      return {
        employees: employees.count,
        shifts: shifts.count,
        attendance: attendance.count,
        leaves: leaves.count,
        notifications: notifications.count,
      };
    });

    console.log(
      `[wipe-staff] ${req.user.id} deleted ${result.employees} staff, ${result.shifts} shifts`
    );

    logAudit({ action: 'STAFF_WIPE', entity: 'Employee', actor: req.user, details: { count: result.employees, shifts: result.shifts } });

    res.json({ message: `Deleted ${result.employees} staff accounts`, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/employees/stats/overview
router.get('/stats/overview', authenticateToken, async (req, res) => {
  try {
    const where = outletScope(req);

    const [total, active, byDepartment, byOutlet] = await Promise.all([
      prisma.employee.count({ where: { ...where } }),
      prisma.employee.count({ where: { ...where, isActive: true } }),
      prisma.employee.groupBy({ by: ['department'], _count: true, where: { ...where, isActive: true } }),
      prisma.employee.groupBy({ by: ['outletId'], _count: true, where: { ...where, isActive: true } }),
    ]);

    res.json({ total, active, byDepartment, byOutlet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
