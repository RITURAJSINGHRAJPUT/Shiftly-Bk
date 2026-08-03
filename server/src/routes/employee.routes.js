import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { authenticateToken, requireMinRole, requireRole } from '../middleware/auth.js';
import { outletScope, outletInclude } from '../lib/scope.js';

const router = Router();

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

// POST /api/employees — create employee
router.post('/', authenticateToken, requireMinRole('HR'), async (req, res) => {
  try {
    const { name, email, phone, role, department, outletId, skills, password } = req.body;

    if (!name || !department || !outletId) {
      return res.status(400).json({ error: 'name, department and outletId are required' });
    }

    const hashedPassword = await bcrypt.hash(password || 'shiftly123', 10);

    const employee = await prisma.employee.create({
      data: {
        name,
        email,
        phone,
        role: role || 'STAFF',
        department,
        outletId,
        skills: skills || [],
        password: hashedPassword,
      },
      include: outletInclude,
    });

    const { password: _, ...sanitized } = employee;
    res.status(201).json(sanitized);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/employees/:id
router.put('/:id', authenticateToken, requireMinRole('HR'), async (req, res) => {
  try {
    const { name, email, phone, role, department, outletId, skills, isActive } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (email !== undefined) data.email = email;
    if (phone !== undefined) data.phone = phone;
    if (role !== undefined) data.role = role;
    if (department !== undefined) data.department = department;
    if (outletId !== undefined) data.outletId = outletId;
    if (skills !== undefined) data.skills = skills;
    if (isActive !== undefined) data.isActive = isActive;

    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data,
      include: outletInclude,
    });

    const { password, ...sanitized } = employee;
    res.json(sanitized);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/employees/:id (soft delete)
router.delete('/:id', authenticateToken, requireMinRole('ADMIN'), async (req, res) => {
  try {
    await prisma.employee.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ message: 'Employee deactivated' });
  } catch (err) {
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
 * requireRole rather than requireMinRole: an exact match says "only this role",
 * and cannot be satisfied by some future role ranked above SUPER_ADMIN.
 */
const WIPE_CONFIRMATION = 'DELETE ALL STAFF';

/** The employees a wipe targets. Used by both the preview and the wipe itself. */
const wipeTarget = (req) => ({ role: 'STAFF', id: { not: req.user.id } });

// GET /api/employees/stats/wipe-preview
//
// Two path segments on purpose: a single-segment literal such as /wipe-preview
// would be captured by `router.get('/:id')` above and looked up as an employee.
router.get('/stats/wipe-preview', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
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
router.post('/wipe-staff', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
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
