import { Router } from 'express';
import prisma from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { can, holdsCapability } from '../lib/capabilities.js';
import { processLeaveRequest, approveLeave, rejectLeave, reallocateLeaveShifts } from '../engine/leaveManager.js';
import { AUTO_OFF_REASON } from '../engine/shiftAllocator.js';
import { startOfLocalDay, localDateKey, localDateRange } from '../lib/dates.js';
import { rosterOverrideDenied } from '../lib/rosterOverride.js';
import { requestEmergencyLeave, acceptEmergencyCover, autoAssignEmergency } from '../engine/emergencyLeave.js';
import { employeeScope, hasGlobalScope } from '../lib/scope.js';
import { logAudit } from '../lib/audit.js';
import { DEPARTMENT_APPROVERS } from '../lib/departments.js';

const router = Router();

/**
 * HR/ADMIN/SUPER_ADMIN may act on any leave. A department manager (HEAD_CHEF,
 * MASTER_OF_HOUSE) may only act on their own outlet's leaves, and only for the
 * department they own per DEPARTMENT_APPROVERS. **Nobody signs off their own.**
 * Returns an error string, or null when the action is allowed.
 *
 * An OUTLET_MANAGER is not on this list and is stopped at the route guard
 * before reaching here: leave belongs to the head of the department the person
 * works in, who knows what the absence costs that section.
 *
 * The self-check sits *after* the global-scope return, unlike the overtime twin
 * where it comes first. Overtime can afford to bind admins because they never
 * accrue any — OVERTIME_EXEMPT_ROLES covers them — but leave has no such
 * exemption, and a first-position check would leave a lone super admin's own
 * request unapprovable by anyone in the system.
 *
 * `allowSelf` is for emergency auto-assign: the requester pressing it is the
 * normal case, not an abuse, and autoAssignEmergency already refuses to pick
 * them as their own cover.
 */
function leaveApprovalDenied(req, leave, { allowSelf = false } = {}) {
  if (hasGlobalScope(req.user)) return null;
  if (!allowSelf && leave.employeeId === req.user.id) {
    // "act on", not "approve" — the same string is returned to /reject.
    return 'You cannot act on your own leave request';
  }
  if (leave.employee.outletId !== req.user.outletId) {
    return 'You can only act on leave requests for your own outlet';
  }
  if (DEPARTMENT_APPROVERS[leave.employee.department] !== req.user.role) {
    return 'You can only approve leave requests for your own department';
  }
  return null;
}

/** Employee summary shape reused across this router's responses. */
const leaveEmployeeSelect = {
  select: {
    id: true,
    name: true,
    department: true,
    skills: true,
    outletId: true,
    outlet: { select: { name: true, brand: { select: { name: true } } } },
  },
};

// GET /api/leaves — list leave requests
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, employee, type, startDate, endDate } = req.query;
    const where = { ...employeeScope(req) };

    if (status) where.status = status;
    if (type) where.type = type;

    if (startDate || endDate) {
      where.endDate = startDate ? { gte: new Date(startDate) } : undefined;
      where.startDate = endDate ? { lte: new Date(endDate) } : undefined;
    }

    // Staff can only see their own leaves
    if (req.user.role === 'STAFF') {
      where.employeeId = req.user.id;
    } else if (employee) {
      where.employeeId = employee;
    }

    const leaves = await prisma.leave.findMany({
      where,
      include: { employee: leaveEmployeeSelect },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json(leaves);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leaves — request leave
router.post('/', authenticateToken, async (req, res) => {
  try {
    const leave = await processLeaveRequest(prisma, req.user.id, req.body);
    res.status(201).json(leave);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const LEAVE_TYPES = ['CASUAL', 'SICK', 'EARNED', 'UNPAID'];

/**
 * Validated dates for leave a manager records or changes, or an error string.
 *
 * Local midnight on both ends, the form the allocator stores weekly offs in and
 * the one reallocateLeaveShifts() compares shift dates against. Past dates are
 * allowed here, unlike an employee's own request: recording yesterday's sick
 * day after the fact is exactly what a manager needs this for.
 */
function readLeaveDates(startDate, endDate) {
  if (!startDate || !endDate) return { error: 'Start and end dates are required' };
  const start = startOfLocalDay(startDate);
  const end = startOfLocalDay(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { error: 'Invalid date' };
  if (start > end) return { error: 'Start date must be on or before the end date' };
  return { start, end };
}

/** Another live leave for this person overlapping these dates, if any. */
function overlappingLeave(employeeId, start, end, excludeId) {
  return prisma.leave.findFirst({
    where: {
      employeeId,
      status: { in: ['PENDING', 'APPROVED', 'COVERAGE_PENDING'] },
      startDate: { lte: end },
      endDate: { gte: start },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

/**
 * The days in this range the person is rostered to work, as YYYY-MM-DD.
 *
 * SWAPPED counts: that is a shift they took over as cover, and it is as much a
 * working day as one the allocator gave them.
 */
async function rosteredDays(employeeId, start, end) {
  const shifts = await prisma.shift.findMany({
    where: { employeeId, status: { in: ['ASSIGNED', 'SWAPPED'] }, date: localDateRange(start, end) },
    select: { date: true },
    orderBy: { date: 'asc' },
  });
  return [...new Set(shifts.map((sh) => localDateKey(sh.date)))];
}

/**
 * Leave landing on a working day pulls the person off the roster, which only
 * their department head may decide (see rosterOverrideDenied). Leave on days
 * they are not rostered stays open to Admin and HR as before.
 */
async function workingDayDenied(req, employee, start, end) {
  const days = await rosteredDays(employee.id, start, end);
  if (days.length === 0) return null;
  const list = days.length > 3 ? `${days.slice(0, 3).join(', ')} and ${days.length - 3} more` : days.join(', ');
  return rosterOverrideDenied(req.user, employee, `is rostered to work on ${list}`);
}

const dayRange = (start, end) =>
  localDateKey(start) === localDateKey(end)
    ? localDateKey(start)
    : `${localDateKey(start)} to ${localDateKey(end)}`;

// POST /api/leaves/manage — a manager records leave for someone, approved outright
router.post('/manage', authenticateToken, can('LEAVE_MANAGE'), async (req, res) => {
  try {
    const { employeeId, type = 'CASUAL', startDate, endDate, reason } = req.body;
    if (!LEAVE_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid leave type' });

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId || '' },
      select: { id: true, name: true, outletId: true, department: true },
    });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    const denied = leaveApprovalDenied(req, { employeeId: employee.id, employee });
    if (denied) return res.status(403).json({ error: denied });

    const dates = readLeaveDates(startDate, endDate);
    if (dates.error) return res.status(400).json({ error: dates.error });
    if (await overlappingLeave(employee.id, dates.start, dates.end)) {
      return res.status(409).json({ error: `${employee.name} already has leave on those dates` });
    }
    const onWorkingDay = await workingDayDenied(req, employee, dates.start, dates.end);
    if (onWorkingDay) return res.status(403).json({ error: onWorkingDay });

    const leave = await prisma.leave.create({
      data: {
        employeeId: employee.id,
        type,
        startDate: dates.start,
        endDate: dates.end,
        reason: reason?.trim() || null,
        status: 'APPROVED',
        approvedBy: req.user.id,
        isEmergency: false,
      },
    });

    const reallocations = await reallocateLeaveShifts(prisma, { ...leave, employee });

    await prisma.notification.create({
      data: {
        employeeId: employee.id,
        type: 'LEAVE_APPROVED',
        title: 'Leave Recorded',
        message: `Your manager has recorded ${type.toLowerCase()} leave for you: ${dayRange(dates.start, dates.end)}.`,
      },
    });

    logAudit({
      action: 'LEAVE_CREATE', entity: 'Leave', entityId: leave.id, actor: req.user,
      details: { employeeName: employee.name, type, from: localDateKey(dates.start), to: localDateKey(dates.end) },
    });

    res.status(201).json({ leave, reallocations: reallocations.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/leaves/:id — change a pending or approved leave's dates, type or reason
router.put('/:id', authenticateToken, can('LEAVE_MANAGE'), async (req, res) => {
  try {
    const existing = await prisma.leave.findUnique({
      where: { id: req.params.id },
      include: { employee: { select: { id: true, name: true, outletId: true, department: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Leave not found' });
    const denied = leaveApprovalDenied(req, existing);
    if (denied) return res.status(403).json({ error: denied });
    if (!['PENDING', 'APPROVED'].includes(existing.status)) {
      return res.status(400).json({ error: `A ${existing.status.toLowerCase()} leave cannot be changed` });
    }
    if (existing.isEmergency) {
      return res.status(400).json({ error: 'Emergency leave cannot be edited — cancel it instead' });
    }

    const { type, startDate, endDate, reason } = req.body;
    if (type !== undefined && !LEAVE_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Invalid leave type' });
    }

    const dates = readLeaveDates(startDate || existing.startDate, endDate || existing.endDate);
    if (dates.error) return res.status(400).json({ error: dates.error });
    if (await overlappingLeave(existing.employeeId, dates.start, dates.end, existing.id)) {
      return res.status(409).json({ error: `${existing.employee.name} already has leave on those dates` });
    }
    // Only approved leave takes anyone off the roster; a pending one is decided
    // at approval.
    if (existing.status === 'APPROVED') {
      const onWorkingDay = await workingDayDenied(req, existing.employee, dates.start, dates.end);
      if (onWorkingDay) return res.status(403).json({ error: onWorkingDay });
    }

    // The reason text is the only thing marking an auto weekly off (see
    // AUTO_OFF_REASON). Rewriting it would turn a moved day off into ordinary
    // leave that the next allocation run never clears.
    const isWeeklyOff = existing.reason === AUTO_OFF_REASON;

    const leave = await prisma.leave.update({
      where: { id: existing.id },
      data: {
        startDate: dates.start,
        endDate: dates.end,
        ...(type ? { type } : {}),
        ...(!isWeeklyOff && reason !== undefined ? { reason: reason?.trim() || null } : {}),
      },
    });

    // Approved leave takes effect now, so any shift the new dates cover moves
    // to cover. Shifts already handed away from the old dates stay handed away.
    const reallocations = leave.status === 'APPROVED'
      ? await reallocateLeaveShifts(prisma, { ...leave, employee: existing.employee })
      : [];

    await prisma.notification.create({
      data: {
        employeeId: existing.employeeId,
        type: 'GENERAL',
        title: isWeeklyOff ? 'Weekly Off Moved' : 'Leave Changed',
        message: `${isWeeklyOff ? 'Your weekly off' : 'Your leave'} is now ${dayRange(dates.start, dates.end)}.`,
      },
    });

    logAudit({
      action: 'LEAVE_EDIT', entity: 'Leave', entityId: leave.id, actor: req.user,
      details: {
        employeeName: existing.employee.name,
        from: { start: localDateKey(existing.startDate), end: localDateKey(existing.endDate), type: existing.type },
        to: { start: localDateKey(dates.start), end: localDateKey(dates.end), type: leave.type },
      },
    });

    res.json({ leave, reallocations: reallocations.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/leaves/:id/cancel
 *
 * Not behind a capability guard, because an employee may withdraw their own
 * request while it is still pending — anything further is a manager's, checked
 * per record by leaveApprovalDenied(). Cancelling does not hand back shifts
 * that were reassigned when it was approved; those are edited on the roster.
 */
router.post('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const existing = await prisma.leave.findUnique({
      where: { id: req.params.id },
      include: { employee: { select: { id: true, name: true, outletId: true, department: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Leave not found' });
    if (!['PENDING', 'APPROVED', 'COVERAGE_PENDING'].includes(existing.status)) {
      return res.status(400).json({ error: `This leave is already ${existing.status.toLowerCase()}` });
    }

    const ownPending = existing.employeeId === req.user.id && existing.status === 'PENDING';
    if (!ownPending) {
      if (!holdsCapability(req.user, 'LEAVE_MANAGE')) {
        return res.status(403).json({ error: 'You can only withdraw your own pending request' });
      }
      const denied = leaveApprovalDenied(req, existing);
      if (denied) return res.status(403).json({ error: denied });
    }

    const leave = await prisma.leave.update({
      where: { id: existing.id },
      data: { status: 'CANCELLED' },
    });

    if (!ownPending) {
      await prisma.notification.create({
        data: {
          employeeId: existing.employeeId,
          type: 'GENERAL',
          title: 'Leave Cancelled',
          message: `Your leave for ${dayRange(existing.startDate, existing.endDate)} has been cancelled.`,
        },
      });
    }

    logAudit({
      action: 'LEAVE_CANCEL', entity: 'Leave', entityId: leave.id, actor: req.user,
      details: {
        employeeName: existing.employee.name,
        start: localDateKey(existing.startDate), end: localDateKey(existing.endDate),
      },
    });

    res.json(leave);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leaves/:id/approve
router.post('/:id/approve', authenticateToken, can('LEAVE_APPROVE'), async (req, res) => {
  try {
    const leave = await prisma.leave.findUnique({
      where: { id: req.params.id },
      select: { employeeId: true, employee: { select: { outletId: true, department: true } } },
    });
    if (!leave) return res.status(404).json({ error: 'Leave not found' });
    const denied = leaveApprovalDenied(req, leave);
    if (denied) return res.status(403).json({ error: denied });

    const result = await approveLeave(prisma, req.params.id, req.user.id);

    logAudit({ action: 'LEAVE_APPROVE', entity: 'Leave', entityId: req.params.id, actor: req.user, details: { employeeName: result.employee?.name } });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/leaves/:id/reject
router.post('/:id/reject', authenticateToken, can('LEAVE_REJECT'), async (req, res) => {
  try {
    const leave = await prisma.leave.findUnique({
      where: { id: req.params.id },
      select: { employeeId: true, employee: { select: { outletId: true, department: true } } },
    });
    if (!leave) return res.status(404).json({ error: 'Leave not found' });
    const denied = leaveApprovalDenied(req, leave);
    if (denied) return res.status(403).json({ error: denied });

    const result = await rejectLeave(prisma, req.params.id, req.user.id, req.body.reason);

    logAudit({ action: 'LEAVE_REJECT', entity: 'Leave', entityId: req.params.id, actor: req.user, details: { employeeName: result.employee?.name, reason: req.body.reason } });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/leaves/emergency — request emergency leave
router.post('/emergency', authenticateToken, async (req, res) => {
  try {
    const result = await requestEmergencyLeave(prisma, req.user.id, req.body.reason);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/leaves/emergency/:leaveId/accept — volunteer accepts cover
router.post('/emergency/:leaveId/accept', authenticateToken, async (req, res) => {
  try {
    const result = await acceptEmergencyCover(prisma, req.user.id, req.params.leaveId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/leaves/emergency/:leaveId/auto-assign — called by timer/admin
router.post('/emergency/:leaveId/auto-assign', authenticateToken, can('LEAVE_AUTO_ASSIGN'), async (req, res) => {
  try {
    const leave = await prisma.leave.findUnique({
      where: { id: req.params.leaveId },
      select: { employeeId: true, employee: { select: { outletId: true, department: true } } },
    });
    if (!leave) return res.status(404).json({ error: 'Leave not found' });
    const denied = leaveApprovalDenied(req, leave, { allowSelf: true });
    if (denied) return res.status(403).json({ error: denied });

    const result = await autoAssignEmergency(prisma, req.params.leaveId);
    if (!result) return res.status(404).json({ error: 'Already handled or no eligible employees' });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/leaves/emergency/pending — get pending emergency leaves
//
// Scoped: this list drives the "volunteer to cover" action, so it must only
// show requests the caller could actually cover. It previously returned every
// outlet's emergencies to every authenticated user.
router.get('/emergency/pending', authenticateToken, async (req, res) => {
  try {
    const leaves = await prisma.leave.findMany({
      where: {
        ...employeeScope(req),
        isEmergency: true,
        status: 'COVERAGE_PENDING',
      },
      include: { employee: leaveEmployeeSelect },
      orderBy: { createdAt: 'desc' },
    });
    res.json(leaves);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leaves/stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const scope = employeeScope(req);
    const [pending, approved, emergency, total] = await Promise.all([
      prisma.leave.count({ where: { ...scope, status: 'PENDING' } }),
      prisma.leave.count({ where: { ...scope, status: 'APPROVED' } }),
      prisma.leave.count({
        where: { ...scope, isEmergency: true, status: 'COVERAGE_PENDING' },
      }),
      prisma.leave.count({ where: scope }),
    ]);
    res.json({ pending, approved, emergency, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
