import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { can, canOrOutletManager, holdsCapability } from '../lib/capabilities.js';
import { outletScope, outletInclude, GLOBAL_SCOPE_ROLES, hasGlobalScope } from '../lib/scope.js';
import { ownsDepartment, departmentsFor } from '../lib/departments.js';
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

/** The Department enum, mirrored so a bad value fails as a 400 not a 500. */
const DEPARTMENTS = ['KITCHEN', 'SERVICE', 'HOUSEKEEPING'];

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

  // Checked here rather than left to Prisma, which answers an unknown value with
  // a raw 500 through the generic error handler.
  if (!DEPARTMENTS.includes(nextDepartment)) {
    return { error: `department must be one of ${DEPARTMENTS.join(', ')}` };
  }

  /**
   * A department head works one of the departments their role owns.
   *
   * Their stored department is not what they *manage* — that comes from the
   * role and covers both for a Master of House. It is the section they
   * personally work: which shifts the allocator puts them on, and who signs off
   * their own leave. A Master of House stored KITCHEN was therefore rostered
   * onto kitchen shifts and had their leave routed to the Head Chef, and the
   * form's old default made that the value you got by not touching the field.
   *
   * Note this fires *before* assignmentDenied, so a head chef attempting to
   * create a Master of House now hears about departments rather than roles.
   * The coarser refusal would read better; the stricter one is cheaper to
   * reason about here, and both refuse.
   */
  const owned = departmentsFor(role);
  if (owned.length && !owned.includes(nextDepartment)) {
    const label = role.replace(/_/g, ' ').toLowerCase();
    return { error: `A ${label} works ${owned.join(' or ').toLowerCase()}, not ${nextDepartment.toLowerCase()}` };
  }

  return {
    data: {
      outletId: nextOutlet,
      department: nextDepartment,
      skills: readStations(skills !== undefined ? skills : existing.skills, nextDepartment),
    },
  };
}

/**
 * Who may write this employee record. Returns an error string, or null when the
 * write is allowed.
 *
 * - **HR/ADMIN/SUPER_ADMIN** — any role, any outlet.
 * - **OUTLET_MANAGER** — their own outlet, and only into an outlet-level role:
 *   not a global role and not another Outlet Manager, mirroring the
 *   HR-cannot-assign-management-roles rule below.
 * - **MASTER_OF_HOUSE / HEAD_CHEF** — their own outlet, their own department
 *   (per departments.js), and STAFF only. They know who works for them; HR does
 *   not, and routing every new kitchen porter through HR is what left 45 people
 *   in the system against 343 in the punch log.
 * - Anyone else — denied.
 *
 * The previous version opened `if (req.user.role !== 'OUTLET_MANAGER') return
 * null`, so it was a no-op for every role but one. That was safe only because
 * nothing below HR could reach the routes that call it; the moment a floor
 * dropped, the caller inherited org-wide employee writes. This one closes by
 * default instead.
 *
 * `hasGlobalScope` is keyed on the **actor**; the GLOBAL_SCOPE_ROLES checks in
 * the handlers below are keyed on the **target role**. Two checks, same list,
 * opposite subjects.
 */
function assignmentDenied(req, { outletId, role, department }) {
  if (hasGlobalScope(req.user)) return null;

  if (req.user.role === 'OUTLET_MANAGER') {
    if (outletId !== req.user.outletId) {
      return 'You can only manage employees at your own outlet';
    }
    if (GLOBAL_SCOPE_ROLES.includes(role) || role === 'OUTLET_MANAGER') {
      return 'You cannot assign that role';
    }
    return null;
  }

  if (req.user.role === 'MASTER_OF_HOUSE' || req.user.role === 'HEAD_CHEF') {
    // Role first, deliberately: readAssignment() nulls outletId for a
    // management target, so an outlet-first order would answer "you can only
    // manage employees at your own outlet" when a head chef tries to create an
    // admin — the right refusal with a misleading reason, and that string is
    // what the client shows the user.
    if (role !== 'STAFF') {
      return 'You can only add staff members';
    }
    if (!ownsDepartment(req.user.role, department)) {
      return 'You can only manage employees in your own department';
    }
    // A locked role with no resolvable outlet matches nothing on reads
    // (scope.js MATCH_NOTHING); it must write nothing either.
    if (!req.user.outletId || outletId !== req.user.outletId) {
      return 'You can only manage employees at your own outlet';
    }
    return null;
  }

  return 'You are not allowed to manage employees';
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
        // Searchable because the attendance import reports the codes it could
        // not match, and the only way to act on one was to open records until
        // you found it.
        { employeeCode: { contains: search, mode: 'insensitive' } },
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

/**
 * GET /api/employees/lookup?code=DP443 — who does this employee code belong to?
 *
 * Two answers in one call, because they are the two things a manager needs at
 * the moment they type a code. Either it is already someone's — in which case
 * enrolling again would fail on the unique constraint with a message naming
 * only the field — or the punch log knows a name for it, and the form can fill
 * that in rather than relying on somebody typing it correctly from memory.
 *
 * A code held at another restaurant is reported without the name. The holder is
 * outside the caller's scope everywhere else in the app, and a lookup that
 * returned them would be a way to enumerate other outlets' staff.
 *
 * Declared before /:id, or "lookup" is read as an employee id.
 */
router.get('/lookup', authenticateToken, can('EMPLOYEE_ENROL'), async (req, res) => {
  try {
    const code = req.query.code?.trim();
    if (!code) return res.status(400).json({ error: 'code is required' });

    const [holder, identity] = await Promise.all([
      prisma.employee.findUnique({
        where: { employeeCode: code },
        select: { id: true, name: true, isActive: true, outletId: true, department: true, outlet: { select: { name: true } } },
      }),
      prisma.punchIdentity.findUnique({ where: { userid: code } }),
    ]);

    // Deactivated people keep their code, and the directory hides them — so
    // without this the constraint would refuse a code that appears unused.
    const mine = holder && (hasGlobalScope(req.user) || holder.outletId === req.user.outletId);

    res.json({
      code,
      takenBy: holder
        ? (mine
          ? { name: holder.name, outlet: holder.outlet?.name ?? null, department: holder.department, isActive: holder.isActive }
          : { name: null, outlet: null, department: null, isActive: holder.isActive })
        : null,
      elsewhere: Boolean(holder && !mine),
      suggestedName: identity?.name ?? null,
      lastSeen: identity?.lastSeen ?? null,
      punchCount: identity?.punchCount ?? 0,
    });
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

/**
 * PUT /api/employees/codes — assign employee codes in bulk.
 *
 * The code is how a punch in the attendance log finds its way to a person, and
 * the import reports every id it could not match. Setting them one modal at a
 * time made that report unusable for a roster of any size.
 *
 * Declared before PUT /:id, or "codes" would be read as an employee id.
 *
 * Deliberately not one transaction: a single duplicate would abort the whole
 * batch, and the shared P2002 handler would report the *field* rather than
 * which row caused it — so a page of forty assignments would fail with one
 * unhelpful message. Each row is applied on its own and the failures come back
 * named, so the caller can fix those and keep the rest.
 */
router.put('/codes', authenticateToken, can('EMPLOYEE_EDIT'), async (req, res) => {
  try {
    const { assignments } = req.body;
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ error: 'assignments must be a non-empty array' });
    }
    if (assignments.length > 500) {
      return res.status(400).json({ error: 'At most 500 assignments at a time' });
    }

    const normalised = assignments.map((a) => ({
      id: a.id,
      employeeCode: a.employeeCode?.trim() || null,
    }));

    const conflicts = [];
    const applied = [];

    // Caught here rather than by the unique constraint, which would otherwise
    // apply the first of a duplicated pair and reject the second, leaving the
    // caller to guess which.
    const seen = new Map();
    for (const a of normalised) {
      if (!a.id) { conflicts.push({ ...a, reason: 'Missing employee id' }); continue; }
      if (a.employeeCode && seen.has(a.employeeCode)) {
        conflicts.push({ ...a, reason: 'Listed twice in this request' });
        continue;
      }
      if (a.employeeCode) seen.set(a.employeeCode, a.id);
      applied.push(a);
    }

    const targets = await prisma.employee.findMany({
      where: { id: { in: applied.map((a) => a.id) } },
      select: { id: true, outletId: true, role: true, department: true },
    });
    const targetById = new Map(targets.map((t) => [t.id, t]));

    let updated = 0;
    for (const a of applied) {
      const target = targetById.get(a.id);
      if (!target) { conflicts.push({ ...a, reason: 'No such employee' }); continue; }

      // An outlet manager may only touch their own restaurant's people.
      const denied = assignmentDenied(req, target);
      if (denied) { conflicts.push({ ...a, reason: denied }); continue; }

      try {
        await prisma.employee.update({ where: { id: a.id }, data: { employeeCode: a.employeeCode } });
        updated++;
      } catch (err) {
        conflicts.push({
          ...a,
          reason: err.code === 'P2002'
            ? 'That code is already used by another employee'
            : err.message,
        });
      }
    }

    if (updated > 0) {
      logAudit({
        action: 'EMPLOYEE_EDIT',
        entity: 'Employee',
        actor: req.user,
        details: { bulkCodes: updated, conflicts: conflicts.length },
      });
    }

    res.json({ updated, conflicts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/employees — create employee
router.post('/', authenticateToken, can('EMPLOYEE_ENROL'), async (req, res) => {
  try {
    const { name, email, phone, role, department, outletId, skills, employeeCode } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });

    // Trimmed to null for the same reason employeeCode is, below: '' is not
    // exempt from the unique constraint, so a second record with a blank email
    // would collide with the first and report "that email is already in use".
    const cleanEmail = email?.trim() || null;
    const cleanCode = employeeCode?.trim() || null;

    // One or the other. Email is how someone signs in; a code is how a punch
    // finds them. Line staff who clock in on the reader and never open the app
    // need only the second, and demanding an address they do not have was what
    // made enrolling them an HR errand.
    if (!cleanEmail && !cleanCode) {
      return res.status(400).json({
        error: 'Either an email (for signing in) or an employee code (for attendance) is required',
      });
    }

    // Which fields are even asked for depends on the role: an HR account has no
    // outlet or department to give, and demanding them was why the super admin
    // ended up claiming a restaurant it had nothing to do with.
    const effectiveRole = role || 'STAFF';

    if (req.user.role === 'HR' && GLOBAL_SCOPE_ROLES.includes(effectiveRole)) {
      return res.status(403).json({ error: 'HR cannot assign management roles' });
    }

    /**
     * A department head enrolling into their own patch, rather than HR
     * enrolling anyone anywhere. The floor on this route admits both, so the
     * difference is drawn here — the same in-handler split the shift-pattern
     * clear uses, rather than a second endpoint that would duplicate the whole
     * create path.
     */
    const restricted = !holdsCapability(req.user, 'EMPLOYEE_CREATE');
    let targetOutletId = outletId;
    let targetDepartment = department;

    if (restricted) {
      // Pinned, not compared — the same way outletScope() applies the caller's
      // outlet "instead of, not alongside, the requested scope". A form that
      // still defaults an outlet field would otherwise produce puzzling 403s.
      targetOutletId = req.user.outletId;

      // Filled in when absent, never overridden. A head chef who explicitly
      // asks for SERVICE should be refused, not silently given a KITCHEN
      // record they did not ask for — assignmentDenied() below does the
      // refusing, and it cannot if the value has already been rewritten.
      const owned = departmentsFor(req.user.role);
      if (!targetDepartment && owned.length === 1) targetDepartment = owned[0];

      if (!cleanCode) {
        return res.status(400).json({
          error: 'An employee code is required — it is how their attendance is matched',
        });
      }
      // Without this a head chef could mint a working login at their own
      // restaurant and be handed its one-time password: an account that can
      // file leave and accept cover, attributed to someone who does not exist.
      if (cleanEmail) {
        return res.status(400).json({
          error: 'These records are clock-in only. Ask HR to add a sign-in address.',
        });
      }
    }

    const { data: assignment, error } = readAssignment(
      effectiveRole, { outletId: targetOutletId, department: targetDepartment, skills }
    );
    if (error) return res.status(400).json({ error });

    const denied = assignmentDenied(req, { outletId: assignment.outletId, role: effectiveRole, department: assignment.department });
    if (denied) return res.status(403).json({ error: denied });

    // Generated here, never supplied. The old `password || 'shiftly123'` meant
    // every account in the system shared one password that nobody could change.
    const temporaryPassword = generateTemporaryPassword();

    const employee = await prisma.employee.create({
      data: {
        name,
        email: cleanEmail,
        phone,
        role: effectiveRole,
        employeeCode: cleanCode,
        ...assignment,
        password: await bcrypt.hash(temporaryPassword, 10),
        mustChangePassword: true,
      },
      include: outletInclude,
    });

    const { password: _, ...sanitized } = employee;

    logAudit({
      action: 'EMPLOYEE_CREATE', entity: 'Employee', entityId: employee.id, actor: req.user,
      details: {
        employeeName: name, role: effectiveRole,
        employeeCode: cleanCode, department: assignment.department, outletId: assignment.outletId,
      },
    });

    // The password is still generated and hashed even for a code-only record:
    // leaving password:'' with mustChangePassword:false would mean that adding
    // an email later produced a login with an empty hash that bcrypt can never
    // match and that the holder cannot reset themselves. This way it degrades
    // to "needs a password reset", which is already a supported action.
    res.status(201).json({ ...sanitized, ...(cleanEmail ? { temporaryPassword } : {}) });
  } catch (err) {
    if (err.code === 'P2002') {
      const field = err.meta?.target?.[0] || 'value';
      return res.status(400).json({ error: `That ${field} is already in use by another employee` });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/employees/:id
 *
 * Guarded at the enrolment floor rather than EMPLOYEE_EDIT, because a manager
 * who can add someone has to be able to fix them: a mistyped employee code is
 * the failure mode with teeth — the import silently drops that person's hours
 * and reports an unmatched id to somebody else. assignmentDenied() then narrows
 * a department head to their own outlet, their own department and Staff only,
 * checked against both the record as it is and as it would become.
 */
router.put('/:id', authenticateToken, can('EMPLOYEE_ENROL'), async (req, res) => {
  try {
    const { name, email, phone, role, department, outletId, skills, isActive, employeeCode } = req.body;

    const existing = await prisma.employee.findUnique({
      where: { id: req.params.id },
      select: {
        role: true, department: true, outletId: true, skills: true,
        email: true, employeeCode: true,
      },
    });
    if (!existing) return res.status(404).json({ error: 'Employee not found' });

    /**
     * A department head may correct their own staff — a name, a mistyped code —
     * but never promote or move them.
     *
     * Refused rather than quietly pinned: the edit form posts the whole record,
     * so an unchanged value arriving is normal and only a real difference is an
     * attempt. Answering 200 to "make this person a head chef" while leaving
     * them a staff member would be a lie the caller cannot see.
     */
    const restricted = !holdsCapability(req.user, 'EMPLOYEE_EDIT');
    if (restricted) {
      const attempted = [
        [role, existing.role, "someone's role"],
        [outletId, existing.outletId, 'which restaurant someone works at'],
        [department, existing.department, "someone's department"],
        [isActive, undefined, 'whether an account is active'],
      ].find(([next, current]) => next !== undefined && next !== current);

      if (attempted) {
        return res.status(403).json({ error: `You cannot change ${attempted[2]}` });
      }
    }

    const targetRole = restricted ? existing.role : role;
    const targetOutletId = restricted ? existing.outletId : outletId;
    const targetDepartment = restricted ? existing.department : department;

    const data = {};
    if (name !== undefined) data.name = name;
    // Same trim-to-null as the create path: clearing the field in the form
    // sends '', which is not exempt from the unique constraint.
    if (email !== undefined) data.email = email?.trim() || null;
    if (phone !== undefined) data.phone = phone;
    if (!restricted && role !== undefined) data.role = role;
    if (!restricted && isActive !== undefined) data.isActive = isActive;
    // Empty string, not null, would still collide with the next empty string
    // under the @unique constraint — only null is exempt from it.
    if (employeeCode !== undefined) data.employeeCode = employeeCode?.trim() || null;

    // Judged against the *effective* role, because this handler is partial: a
    // request that changes only the role still has to move the assignment with
    // it — promoting a head chef to HR clears the outlet, and demoting an HR
    // back has to be given one rather than silently landing nowhere.
    const effectiveRole = targetRole ?? existing.role;

    if (req.user.role === 'HR' && GLOBAL_SCOPE_ROLES.includes(effectiveRole)) {
      return res.status(403).json({ error: 'HR cannot assign management roles' });
    }

    const { data: assignment, error } = readAssignment(
      effectiveRole, { outletId: targetOutletId, department: targetDepartment, skills }, existing
    );
    if (error) return res.status(400).json({ error });

    // Both the record as it will be and as it is: a manager must own the person
    // they are editing as well as the result of the edit.
    const denied = assignmentDenied(req, { outletId: assignment.outletId, role: effectiveRole, department: assignment.department })
      || assignmentDenied(req, { outletId: existing.outletId, role: existing.role, department: existing.department });
    if (denied) return res.status(403).json({ error: denied });

    // A record needs at least one identifier. Clearing both the email and the
    // code would leave a row nobody can sign in as and no punch can ever reach.
    const nextEmail = data.email !== undefined ? data.email : existing.email;
    const nextCode = data.employeeCode !== undefined ? data.employeeCode : existing.employeeCode;
    if (!nextEmail && !nextCode) {
      return res.status(400).json({
        error: 'Keep either an email or an employee code — a record with neither can never be reached',
      });
    }

    Object.assign(data, assignment);

    /**
     * Giving a clock-in-only record an email is the moment it becomes an
     * account, so it gets its first password here.
     *
     * Enrolment by a department head produces someone with a code and no
     * sign-in. The obvious way to give them one — add an email, then press the
     * key icon — meant two steps, and the second was refused until the first
     * had been saved, which reads as a bug rather than a sequence. Doing it in
     * the same write removes the gap where the account exists but cannot be
     * signed into and nobody has been told.
     *
     * Only on the transition. Editing someone who already has an email leaves
     * their password alone, or correcting a typo in an address would silently
     * lock them out.
     */
    const gainsLogin = !existing.email && Boolean(data.email);
    let temporaryPassword = null;
    if (gainsLogin && holdsCapability(req.user, 'EMPLOYEE_RESET_PW')) {
      temporaryPassword = generateTemporaryPassword();
      data.password = await bcrypt.hash(temporaryPassword, 10);
      data.mustChangePassword = true;
    }

    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data,
      include: outletInclude,
    });

    const { password, ...sanitized } = employee;

    logAudit({
      action: 'EMPLOYEE_EDIT', entity: 'Employee', entityId: employee.id, actor: req.user,
      details: { employeeName: employee.name, ...(temporaryPassword ? { issuedLogin: true } : {}) },
    });

    res.json({ ...sanitized, ...(temporaryPassword ? { temporaryPassword } : {}) });
  } catch (err) {
    // Both were mapped on POST but not here, so renaming onto a taken email or
    // editing a row deleted underneath you surfaced as a bare 500.
    if (err.code === 'P2002') {
      const field = err.meta?.target?.[0] || 'value';
      return res.status(400).json({ error: `That ${field} is already in use by another employee` });
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
      select: { id: true, name: true, email: true, role: true, outletId: true, department: true },
    });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    // A clock-in-only record has no sign-in address, so a password for it could
    // never be used — login looks accounts up by email.
    if (!employee.email) {
      return res.status(400).json({
        error: 'This is a clock-in-only record — it has no sign-in address to reset. Add an email first.',
      });
    }

    const denied = assignmentDenied(req, { outletId: employee.outletId, role: employee.role, department: employee.department });
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
      select: { role: true, outletId: true, department: true },
    });
    if (!target) return res.status(404).json({ error: 'Employee not found' });
    const denied = assignmentDenied(req, { outletId: target.outletId, role: target.role, department: target.department });
    if (denied) return res.status(403).json({ error: denied });

    // HR has global scope, so assignmentDenied() lets them past for any target.
    // Without this, giving HR deactivation would let them lock out an Admin or
    // Super Admin — the same line as "HR cannot assign management roles".
    if (req.user.role === 'HR' && GLOBAL_SCOPE_ROLES.includes(target.role)) {
      return res.status(403).json({ error: 'HR cannot deactivate management accounts' });
    }

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
