import { Router } from 'express';
import prisma from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { can, holdsCapability } from '../lib/capabilities.js';
import { rosterOverrideDenied, odcDenied } from '../lib/rosterOverride.js';
import { autoAllocateShifts, AUTO_OFF_REASON, outletResetOps } from '../engine/shiftAllocator.js';
import { outletScope, hasGlobalScope } from '../lib/scope.js';
import { departmentsFor, ownsDepartment } from '../lib/departments.js';
import { localDateRange, startOfLocalDay, localDateKey } from '../lib/dates.js';
import { logAudit } from '../lib/audit.js';

const router = Router();

/** Outlet summary shape reused across this router's responses. */
const outletSelect = {
  select: { id: true, name: true, brand: { select: { id: true, name: true } } },
};

/**
 * A locked role (Head Chef, Master of House, Outlet Manager) may only touch
 * shifts at their own outlet. Global roles pass unconditionally. Returns an
 * error string, or null when the write is allowed.
 *
 * None of create/edit/delete/auto-allocate checked this before — outletId
 * came straight from the request body with no verification it matched the
 * caller's own outlet, so any locked role could already act on another
 * outlet's shifts by supplying its id.
 */
function outletShiftDenied(req, outletId) {
  if (hasGlobalScope(req.user)) return null;
  if (!outletId || outletId !== req.user.outletId) {
    return 'You can only manage shifts for your own outlet';
  }
  return null;
}

/**
 * The department half of the same rule: a Head Chef rosters Kitchen, a Master of
 * House rosters Service and Housekeeping.
 *
 * Employees, leave and overtime have all enforced this for a while; shifts
 * checked only the outlet, so a head chef could create, move or delete Service
 * shifts at their own restaurant. The tiers are ordered exactly as
 * leaveApprovalDenied() in leave.routes.js, so the two rules read the same and
 * cannot quietly diverge.
 *
 * A shift carries no department of its own — it inherits the employee's — so
 * the department has to be fetched, which is why the callers are async.
 */
function departmentShiftDenied(req, department) {
  if (hasGlobalScope(req.user)) return null;
  // An Outlet Manager runs the whole restaurant, every department in it —
  // rostering is the job the role exists for. Note this is *not* the shape of
  // leaveApprovalDenied() next door, which turns them away entirely: building
  // the week is theirs, deciding who is absent from it is the department
  // head's. The two functions are deliberately no longer mirrors.
  if (req.user.role === 'OUTLET_MANAGER') return null;
  if (!ownsDepartment(req.user.role, department)) {
    const owned = departmentsFor(req.user.role);
    return owned.length
      ? `You can only manage shifts for ${owned.join(' and ').toLowerCase()}`
      : 'You are not allowed to manage shifts';
  }
  return null;
}

/**
 * Outlet and department in one call, for the employee a shift is being written
 * against. Returns an error string or null.
 */
async function shiftWriteDenied(req, { outletId, employeeId }) {
  const outletDenied = outletShiftDenied(req, outletId);
  if (outletDenied) return outletDenied;

  // Global scope and outlet managers are past the department rule already, so
  // the lookup is skipped for them rather than run and ignored.
  if (hasGlobalScope(req.user) || req.user.role === 'OUTLET_MANAGER') return null;
  if (!employeeId) return 'An employee is required';

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { department: true },
  });
  if (!employee) return 'Employee not found';

  return departmentShiftDenied(req, employee.department);
}

/** "HH:MM" as minutes from midnight, with an end at or before the start read as past midnight. */
function shiftSpan(startTime, endTime) {
  const toMin = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return h * 60 + (m || 0);
  };
  const start = toMin(startTime);
  let end = toMin(endTime);
  if (end <= start) end += 24 * 60;
  return [start, end];
}

/**
 * Why this person cannot work this shift, or null when they can.
 *
 * Checked on every manual write. Before this, adding or moving a shift by hand
 * would happily put someone on a day they had approved leave, or on top of a
 * shift they were already working — the allocator guards against both, the
 * manual paths did not.
 *
 * Returns `{ error, code, leaves }`. A clash with another shift is absolute. A
 * clash with approved leave comes back as code `ON_LEAVE` with the leaves in
 * question, because that one a manager may override — calling someone in on
 * their day off is a real decision, not a mistake — by resending with
 * `overrideLeave`. The shift clash is checked first so an override can never
 * get past it.
 */
async function shiftConflict({ employeeId, date, startTime, endTime, excludeShiftId, kind = 'RESTAURANT' }) {
  const day = localDateRange(date);

  const sameDay = await prisma.shift.findMany({
    where: {
      employeeId,
      date: day,
      status: { not: 'CANCELLED' },
      ...(excludeShiftId ? { id: { not: excludeShiftId } } : {}),
    },
    include: { employee: { select: { name: true } } },
  });
  // ODC and the restaurant never share a day, whatever the hours: someone out
  // at a catering job is not also on a station, and the restaurant shift has
  // to be moved by hand before they go.
  const otherKind = sameDay.find((s) => s.kind !== kind);
  if (otherKind) {
    const name = otherKind.employee.name;
    const hours = `${otherKind.startTime}–${otherKind.endTime}`;
    return {
      error: kind === 'ODC'
        ? `${name} has a ${otherKind.section || 'restaurant'} shift ${hours} that day — move it before sending them to ODC`
        : `${name} is at ODC that day (${hours})`,
    };
  }

  const [start, end] = shiftSpan(startTime, endTime);
  const clash = sameDay.find((s) => {
    const [sStart, sEnd] = shiftSpan(s.startTime, s.endTime);
    return start < sEnd && sStart < end;
  });
  if (clash) {
    return { error: `${clash.employee.name} already works ${clash.startTime}–${clash.endTime} that day` };
  }

  const leaves = await prisma.leave.findMany({
    where: {
      employeeId,
      status: 'APPROVED',
      startDate: { lt: day.lt },
      endDate: { gte: day.gte },
    },
    include: { employee: { select: { id: true, name: true, department: true } } },
  });
  if (leaves.length) {
    const weeklyOff = leaves.every((l) => l.reason === AUTO_OFF_REASON);
    return {
      code: 'ON_LEAVE',
      leaves,
      error: `${leaves[0].employee.name} is on ${weeklyOff ? 'their weekly off' : 'approved leave'} that day`,
    };
  }
  return null;
}

/**
 * Take one day out of each leave, so the person can work it.
 *
 * Only that day: a week's holiday with a Wednesday called in becomes Mon–Tue
 * and Thu–Sun, not no holiday. Dates are compared as local calendar days
 * because leave rows are stored both at local midnight (weekly offs, manager-
 * recorded leave) and at UTC midnight (an employee's own request).
 */
async function freeDayFromLeaves(req, leaves, date) {
  const day = startOfLocalDay(date);
  const key = localDateKey(day);
  const before = new Date(day); before.setDate(before.getDate() - 1);
  const after = new Date(day); after.setDate(after.getDate() + 1);

  for (const leave of leaves) {
    const startKey = localDateKey(leave.startDate);
    const endKey = localDateKey(leave.endDate);
    const { id, employee, createdAt, updatedAt, ...copy } = leave;

    if (startKey === key && endKey === key) {
      await prisma.leave.update({ where: { id }, data: { status: 'CANCELLED' } });
    } else if (startKey === key) {
      await prisma.leave.update({ where: { id }, data: { startDate: after } });
    } else if (endKey === key) {
      await prisma.leave.update({ where: { id }, data: { endDate: before } });
    } else {
      await prisma.leave.update({ where: { id }, data: { endDate: before } });
      await prisma.leave.create({ data: { ...copy, startDate: after } });
    }

    const what = leave.reason === AUTO_OFF_REASON ? 'weekly off' : 'leave';
    await prisma.notification.create({
      data: {
        employeeId: leave.employeeId,
        type: 'GENERAL',
        title: 'Called In on Leave',
        message: `You have been rostered on ${key}, so that day has been taken off your ${what}.`,
      },
    });

    logAudit({
      action: 'LEAVE_EDIT', entity: 'Leave', entityId: id, actor: req.user,
      details: { employeeName: employee?.name, calledInOn: key, from: { start: startKey, end: endKey } },
    });
  }
}

/**
 * The clash check plus the override, for both write routes. Returns
 * `{ status, body }` to refuse with, or `{ leavesToFree }` (possibly empty)
 * when the write may go ahead — the leave is only touched once the shift has
 * actually been saved.
 */
async function checkShiftSlot(req, slot, overrideLeave) {
  const conflict = await shiftConflict(slot);
  if (!conflict) return { leavesToFree: [] };
  if (conflict.code !== 'ON_LEAVE') return { status: 409, body: { error: conflict.error } };

  const denied = rosterOverrideDenied(req.user, conflict.leaves[0].employee, 'is on leave that day');
  if (denied) return { status: 403, body: { error: denied } };
  if (!overrideLeave) {
    return { status: 409, body: { error: conflict.error, code: 'ON_LEAVE' } };
  }
  return { leavesToFree: conflict.leaves };
}

/**
 * The section a Service or Housekeeping shift carries: its department's own
 * name, copied from the pattern it was allocated from (Shift Master keys those
 * rows by it). It names the department, not a station.
 */
const DEPARTMENT_ROW_SECTION = { SERVICE: 'service', HOUSEKEEPING: 'housekeeping' };

/**
 * The kitchen-only rule for stations. Returns an error string or null.
 *
 * A department's own name is allowed only for someone who works in it or, as a
 * head, runs it — a Master of House may take a "Housekeeping" shift, a waiter
 * or a cook may not. Refusing every section outside the kitchen meant no
 * allocated Service or Housekeeping shift could be edited at all.
 */
async function stationDenied(employeeId, section) {
  if (!section) return null;
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { name: true, department: true, role: true },
  });
  if (!employee) return 'Employee not found';

  const wanted = String(section).trim().toLowerCase();
  const rowDepartment = Object.keys(DEPARTMENT_ROW_SECTION)
    .find((d) => DEPARTMENT_ROW_SECTION[d] === wanted);
  if (rowDepartment) {
    const own = [employee.department, ...departmentsFor(employee.role)];
    return own.includes(rowDepartment)
      ? null
      : `${employee.name} works in ${employee.department?.toLowerCase()}, not ${rowDepartment.toLowerCase()}`;
  }

  if (employee.department !== 'KITCHEN') {
    return `${employee.name} works in ${employee.department} — stations apply to kitchen shifts only`;
  }
  return null;
}

// GET /api/shifts — list shifts with filters
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { date, startDate, endDate, employee, status } = req.query;
    const where = { ...outletScope(req) };

    if (employee) where.employeeId = employee;
    if (status) where.status = status;
    // Local-day bounds. `new Date('2026-07-27')` is UTC midnight, which sits
    // after a row stored at local midnight east of UTC — that dropped the first
    // day of every range.
    if (date) {
      where.date = localDateRange(date);
    } else if (startDate && endDate) {
      where.date = localDateRange(startDate, endDate);
    }

    const shifts = await prisma.shift.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, department: true, skills: true, avatar: true } },
        outlet: outletSelect,
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });

    res.json(shifts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shifts — create a shift manually
router.post('/', authenticateToken, can('SHIFT_CREATE'), async (req, res) => {
  try {
    const { date, startTime, endTime, employeeId, outletId } = req.body;
    const kind = req.body.kind === 'ODC' ? 'ODC' : 'RESTAURANT';
    const isOdc = kind === 'ODC';
    // An ODC job has no station; its note says where it is instead.
    const section = isOdc ? null : req.body.section;
    const note = isOdc ? (req.body.note?.trim() || null) : null;

    const targetOutletId = outletId || req.user.outletId;
    const denied = await shiftWriteDenied(req, { outletId: targetOutletId, employeeId });
    if (denied) return res.status(403).json({ error: denied });

    if (isOdc) {
      const person = await prisma.employee.findUnique({
        where: { id: employeeId || '' },
        select: { name: true, department: true },
      });
      if (!person) return res.status(400).json({ error: 'Employee not found' });
      const odc = odcDenied(req.user, person);
      if (odc) return res.status(403).json({ error: odc });
    }

    // A shift carries no department of its own — it inherits the one the person
    // works in. Stations are a kitchen concept (only kitchen staff hold the
    // skills the allocator scores them against), so a station on a service
    // shift is dead data that still paints a station tag on the week grid.
    const badStation = await stationDenied(employeeId, section);
    if (badStation) return res.status(400).json({ error: badStation });

    const check = await checkShiftSlot(req, { employeeId, date, startTime, endTime, kind }, req.body.overrideLeave);
    if (check.body) return res.status(check.status).json(check.body);

    const shift = await prisma.shift.create({
      data: {
        // Local midnight, matching the seeder and the allocator. A bare
        // `new Date('2026-07-27')` would land at 05:30 local and break the
        // exact-equality `date:` lookups in the emergency-leave flow.
        date: startOfLocalDay(date),
        startTime,
        endTime,
        section,
        kind,
        note,
        employeeId,
        outletId: targetOutletId,
      },
      include: {
        employee: { select: { id: true, name: true } },
        outlet: outletSelect,
      },
    });

    await freeDayFromLeaves(req, check.leavesToFree, date);

    // Notify employee
    await prisma.notification.create({
      data: {
        employeeId,
        type: 'SHIFT_ASSIGNED',
        title: isOdc ? 'Assigned to ODC' : 'New Shift Assigned',
        message: isOdc
          ? `You're on ODC (outdoor catering) on ${date} (${startTime}-${endTime})${note ? `: ${note}` : ''}.`
          : `You've been assigned a ${section || 'general'} shift on ${new Date(date).toLocaleDateString()} (${startTime}-${endTime}).`,
      },
    });

    logAudit({ action: 'SHIFT_CREATE', entity: 'Shift', entityId: shift.id, actor: req.user, details: { employeeName: shift.employee?.name, date, section, kind, ...(note ? { note } : {}) } });

    res.status(201).json(shift);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shifts/auto-allocate
router.post('/auto-allocate', authenticateToken, can('SHIFT_ALLOCATE'), async (req, res) => {
  try {
    const { outletId, startDate, endDate } = req.body;
    const targetOutletId = outletId || req.user.outletId;
    const denied = outletShiftDenied(req, targetOutletId);
    if (denied) return res.status(403).json({ error: denied });

    // A department head's run must not touch the other departments' rosters:
    // the allocator clears the range before rebuilding it, so an unscoped run
    // by a head chef wiped Service and Housekeeping too. Empty for global roles
    // and outlet managers, which the allocator reads as "all departments".
    const owned = hasGlobalScope(req.user) || req.user.role === 'OUTLET_MANAGER'
      ? null
      : departmentsFor(req.user.role);

    const result = await autoAllocateShifts(prisma, targetOutletId, startDate, endDate, {
      departments: owned,
    });

    logAudit({ action: 'SHIFT_ALLOCATE', entity: 'Shift', actor: req.user, details: { outletId: targetOutletId, count: result.count, startDate, endDate } });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Resolve the outlet a reset is aimed at, or an error to send back.
 *
 * Deliberately does NOT fall back to `req.user.outletId` the way the create and
 * allocate handlers above do. outletShiftDenied() waves a global role through
 * unconditionally — including when outletId is undefined — and Prisma drops
 * undefined keys, so `deleteMany({ where: { outletId: undefined } })` is
 * `DELETE FROM "Shift"`. An ADMIN belongs to no outlet, so the fallback yields
 * undefined and a bare {} body would wipe every outlet in the organisation.
 * The other handlers survive the same hole only because they hand the value to
 * a create/findUnique that fails loudly.
 *
 * The existence check matters for the same reason: deleteMany on an id that
 * does not exist returns { count: 0 } and would report success.
 */
async function resolveResetTarget(req) {
  const outletId = req.query.outlet || req.body?.outletId;
  if (!outletId) return { status: 400, error: 'outletId is required' };

  const denied = outletShiftDenied(req, outletId);
  if (denied) return { status: 403, error: denied };

  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { id: true, name: true },
  });
  if (!outlet) return { status: 404, error: 'Outlet not found' };

  return { outlet };
}

// GET /api/shifts/stats/reset-preview?outlet=<id>
// Two segments, like /employees/stats/wipe-preview, so a future GET /:id on
// this router cannot capture it.
router.get('/stats/reset-preview', authenticateToken, can('SHIFT_RESET_PREVIEW'), async (req, res) => {
  try {
    const target = await resolveResetTarget(req);
    if (target.error) return res.status(target.status).json({ error: target.error });
    const outletId = target.outlet.id;

    const [byStatus, span, autoLeaves, notifications] = await Promise.all([
      prisma.shift.groupBy({ by: ['status'], where: { outletId }, _count: { _all: true } }),
      prisma.shift.aggregate({ where: { outletId }, _min: { date: true }, _max: { date: true } }),
      prisma.leave.count({ where: { reason: AUTO_OFF_REASON, employee: { outletId } } }),
      prisma.notification.count({ where: { type: 'SHIFT_ASSIGNED', employee: { outletId } } }),
    ]);

    const counts = Object.fromEntries(byStatus.map(r => [r.status, r._count._all]));
    const total = byStatus.reduce((sum, r) => sum + r._count._all, 0);

    res.json({
      outletName: target.outlet.name,
      total,
      byStatus: counts,
      // Called out separately because this is the part that is not replaceable:
      // re-running auto-allocation restores ASSIGNED shifts, never history.
      completed: (counts.COMPLETED || 0) + (counts.MISSED || 0),
      earliest: span._min.date,
      latest: span._max.date,
      autoLeaves,
      notifications,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shifts/reset
// POST rather than DELETE for the reason given on /employees/wipe-staff: the
// client's delete() sends no body, and this needs one.
router.post('/reset', authenticateToken, can('SHIFT_RESET'), async (req, res) => {
  try {
    const target = await resolveResetTarget(req);
    if (target.error) return res.status(target.status).json({ error: target.error });
    const { id: outletId, name: outletName } = target.outlet;

    // Array form, not the interactive callback: that one carries a 5s default
    // timeout, which a large outlet's delete can exceed for no good reason.
    const [shifts, autoLeaves, notifications] = await prisma.$transaction(
      outletResetOps(prisma, outletId)
    );

    const details = {
      outletId,
      outletName,
      shifts: shifts.count,
      autoLeaves: autoLeaves.count,
      notifications: notifications.count,
    };

    // logAudit is fire-and-forget and swallows its own failures, so for the
    // most destructive operation on this router stdout is the only guaranteed
    // trace. Same reasoning as the staff wipe.
    console.log(
      `[shift-reset] ${req.user.id} reset ${outletName}: ${shifts.count} shifts, ` +
      `${autoLeaves.count} auto-off leaves, ${notifications.count} notifications`
    );
    logAudit({ action: 'SHIFT_RESET', entity: 'Shift', actor: req.user, details });

    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/shifts/:id — move a shift to another person, day, time or station
router.put('/:id', authenticateToken, can('SHIFT_EDIT'), async (req, res) => {
  try {
    const existing = await prisma.shift.findUnique({
      where: { id: req.params.id },
      include: { employee: { select: { name: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Shift not found' });

    const { date, startTime, endTime, section, employeeId, status } = req.body;

    // Both ends of a reassignment. Checking only the shift's current employee
    // would let a head chef move a Kitchen shift onto a Service person;
    // checking only the incoming one would let them take a Service shift over.
    const denied = await shiftWriteDenied(req, {
      outletId: existing.outletId,
      employeeId: existing.employeeId,
    }) || (employeeId && employeeId !== existing.employeeId
      ? await shiftWriteDenied(req, { outletId: existing.outletId, employeeId })
      : null);
    if (denied) return res.status(403).json({ error: denied });

    // ODC belongs to the department head at both ends, like its creation.
    // `kind` itself never changes: a restaurant shift is not turned into an ODC
    // job, the ODC is added and the shift moved.
    const isOdc = existing.kind === 'ODC';
    if (isOdc) {
      const ids = [...new Set([existing.employeeId, employeeId].filter(Boolean))];
      const people = await prisma.employee.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, department: true },
      });
      if (people.length !== ids.length) return res.status(400).json({ error: 'Employee not found' });
      const odc = people.map((p) => odcDenied(req.user, p)).find(Boolean);
      if (odc) return res.status(403).json({ error: odc });
    }

    // The shift as it will be once saved — each check has to see the new person
    // on the new day at the new times, not whichever half the body happened to
    // include.
    const next = {
      employeeId: employeeId || existing.employeeId,
      date: date ? startOfLocalDay(date) : existing.date,
      startTime: startTime || existing.startTime,
      endTime: endTime || existing.endTime,
      section: isOdc ? null : (section !== undefined ? (section || null) : existing.section),
      note: isOdc
        ? (req.body.note !== undefined ? (req.body.note?.trim() || null) : existing.note)
        : null,
    };

    const badStation = await stationDenied(next.employeeId, next.section);
    if (badStation) return res.status(400).json({ error: badStation });

    // A cancelled shift occupies nobody, so it needs no room in their day.
    let leavesToFree = [];
    if ((status || existing.status) !== 'CANCELLED') {
      const check = await checkShiftSlot(req, { ...next, kind: existing.kind, excludeShiftId: existing.id }, req.body.overrideLeave);
      if (check.body) return res.status(check.status).json(check.body);
      leavesToFree = check.leavesToFree;
    }

    const shift = await prisma.shift.update({
      where: { id: req.params.id },
      data: { ...next, ...(status ? { status } : {}) },
      include: {
        employee: { select: { id: true, name: true, department: true, skills: true, avatar: true } },
        outlet: outletSelect,
      },
    });

    await freeDayFromLeaves(req, leavesToFree, next.date);

    const when = `${localDateKey(shift.date)} (${shift.startTime}-${shift.endTime})`;
    const what = isOdc
      ? `ODC (outdoor catering) on ${when}${shift.note ? `: ${shift.note}` : ''}`
      : `${shift.section || 'general'} shift on ${when}`;
    if (next.employeeId !== existing.employeeId) {
      await prisma.notification.createMany({
        data: [
          {
            employeeId: next.employeeId,
            type: 'SHIFT_ASSIGNED',
            title: 'Shift Assigned to You',
            message: `You've been assigned ${isOdc ? '' : 'a '}${what}.`,
          },
          {
            employeeId: existing.employeeId,
            type: 'SHIFT_CHANGED',
            title: 'Shift Removed',
            message: `Your ${isOdc ? 'ODC' : `${existing.section || 'general'} shift`} on ${localDateKey(existing.date)} `
              + `(${existing.startTime}-${existing.endTime}) has been given to someone else.`,
          },
        ],
      });
    } else if (
      localDateKey(existing.date) !== localDateKey(shift.date)
      || existing.startTime !== shift.startTime
      || existing.endTime !== shift.endTime
      || (existing.section || null) !== (shift.section || null)
      || (existing.note || null) !== (shift.note || null)
    ) {
      await prisma.notification.create({
        data: {
          employeeId: shift.employeeId,
          type: 'SHIFT_CHANGED',
          title: 'Shift Changed',
          message: `Your ${isOdc ? 'ODC' : 'shift'} is now ${isOdc ? '' : 'a '}${what}.`,
        },
      });
    }

    logAudit({
      action: 'SHIFT_EDIT', entity: 'Shift', entityId: shift.id, actor: req.user,
      details: {
        from: {
          employeeName: existing.employee?.name, date: localDateKey(existing.date),
          startTime: existing.startTime, endTime: existing.endTime, section: existing.section,
        },
        to: {
          employeeName: shift.employee?.name, date: localDateKey(shift.date),
          startTime: shift.startTime, endTime: shift.endTime, section: shift.section,
        },
        ...(isOdc ? { kind: 'ODC' } : {}),
      },
    });

    res.json(shift);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** "Pass shift on 2026-10-05 (12:30-21:30)" — for notification text. */
const describeShift = (s) =>
  `${s.section || 'general'} shift on ${localDateKey(s.date)} (${s.startTime}-${s.endTime})`;

const shiftWithPeople = {
  employee: { select: { id: true, name: true, department: true, outletId: true } },
};

/**
 * POST /api/shifts/swap — two people exchange shifts.
 *
 * Each shift keeps its day, hours and station; only who works it changes. This
 * is what dropping one name on another does in Shift Planning. Every check a
 * single edit runs is run for both people on the shift they are taking, and
 * the two writes are one transaction, so a swap never half-happens.
 *
 * The same call again swaps them back, which is how the page's Undo works.
 * Status is left alone, as an edit leaves it: marking these SWAPPED would make
 * the next auto-allocation keep them as if they were fixed.
 */
router.post('/swap', authenticateToken, can('SHIFT_EDIT'), async (req, res) => {
  try {
    const { shiftId, withShiftId, overrideLeave } = req.body;
    if (!shiftId || !withShiftId || shiftId === withShiftId) {
      return res.status(400).json({ error: 'Pick two different shifts to swap' });
    }

    const [a, b] = await Promise.all([shiftId, withShiftId].map((id) =>
      prisma.shift.findUnique({ where: { id }, include: shiftWithPeople })));
    if (!a || !b) return res.status(404).json({ error: 'Shift not found' });
    if (a.kind === 'ODC' || b.kind === 'ODC') {
      return res.status(400).json({ error: 'ODC jobs are not swapped — change them from the ODC form' });
    }
    if (a.status === 'CANCELLED' || b.status === 'CANCELLED') {
      return res.status(400).json({ error: 'A cancelled shift cannot be swapped' });
    }
    if (a.employeeId === b.employeeId) {
      return res.status(400).json({ error: `Both shifts are ${a.employee.name}'s` });
    }
    if (a.outletId !== b.outletId) {
      return res.status(400).json({ error: 'Both shifts must be at the same restaurant' });
    }

    for (const s of [a, b]) {
      const denied = await shiftWriteDenied(req, { outletId: s.outletId, employeeId: s.employeeId });
      if (denied) return res.status(403).json({ error: denied });
    }

    // Each person on the shift they are taking. Their own current shift is the
    // one they are giving away, so it is excluded from their clash check.
    const moves = [
      { person: a.employee, gives: a, takes: b },
      { person: b.employee, gives: b, takes: a },
    ];
    const toFree = [];
    for (const { person, gives, takes } of moves) {
      const badStation = await stationDenied(person.id, takes.section);
      if (badStation) return res.status(400).json({ error: badStation });

      const check = await checkShiftSlot(req, {
        employeeId: person.id,
        date: takes.date,
        startTime: takes.startTime,
        endTime: takes.endTime,
        kind: 'RESTAURANT',
        excludeShiftId: gives.id,
      }, overrideLeave);
      if (check.body) return res.status(check.status).json(check.body);
      if (check.leavesToFree.length) toFree.push({ leaves: check.leavesToFree, date: takes.date });
    }

    const include = {
      employee: { select: { id: true, name: true, department: true, skills: true, avatar: true } },
      outlet: outletSelect,
    };
    const swapped = await prisma.$transaction([
      prisma.shift.update({ where: { id: a.id }, data: { employeeId: b.employeeId }, include }),
      prisma.shift.update({ where: { id: b.id }, data: { employeeId: a.employeeId }, include }),
    ]);

    for (const { leaves, date } of toFree) await freeDayFromLeaves(req, leaves, date);

    await prisma.notification.createMany({
      data: moves.map(({ person, gives, takes }) => ({
        employeeId: person.id,
        type: 'SHIFT_CHANGED',
        title: 'Shift Swapped',
        message: `You now work the ${describeShift(takes)}, swapped with `
          + `${gives === a ? b.employee.name : a.employee.name}.`,
      })),
    });

    for (const { gives, takes } of moves) {
      logAudit({
        action: 'SHIFT_EDIT', entity: 'Shift', entityId: gives.id, actor: req.user,
        details: {
          from: { employeeName: gives.employee.name },
          to: { employeeName: takes.employee.name },
          date: localDateKey(gives.date), startTime: gives.startTime, endTime: gives.endTime,
          section: gives.section, swapWith: takes.id,
        },
      });
    }

    res.json({ shifts: swapped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** A generated one-day weekly off — the only leave a roster swap may move. */
const isWeeklyOff = (leave) =>
  leave.status === 'APPROVED' && leave.reason === AUTO_OFF_REASON
  && localDateKey(leave.startDate) === localDateKey(leave.endDate);

/**
 * POST /api/shifts/:id/swap-off — someone on their weekly off trades places
 * with someone working that day.
 *
 * The shift's person goes off and takes over the weekly off; the off person
 * comes in and takes over the shift. The day's headcount is unchanged.
 *
 * `mode: 'week'` also trades back on the other day: the person going off gives
 * up their own weekly off that week, and the person coming in hands them their
 * shift on it — so both still have exactly one day off. Refused, with the
 * reason, when that other day cannot be traded.
 *
 * Deciding who works a day the roster and the leave disagree on is the
 * department head's call (LEAVE_ROSTER_OVERRIDE), for both people. The same
 * call again reverses it, which is how the page's Undo works.
 */
router.post('/:id/swap-off', authenticateToken, can('LEAVE_ROSTER_OVERRIDE'), async (req, res) => {
  try {
    const mode = req.body.mode === 'week' ? 'week' : 'day';
    const [shift, leave] = await Promise.all([
      prisma.shift.findUnique({ where: { id: req.params.id }, include: shiftWithPeople }),
      prisma.leave.findUnique({ where: { id: req.body.leaveId || '' }, include: shiftWithPeople }),
    ]);
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    if (!leave) return res.status(404).json({ error: 'Day off not found' });
    if (shift.kind === 'ODC' || shift.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Only a restaurant shift can be traded for a day off' });
    }
    if (!isWeeklyOff(leave)) {
      return res.status(400).json({ error: 'Only a weekly day off can be swapped — other leave stays where it is' });
    }
    if (localDateKey(leave.startDate) !== localDateKey(shift.date)) {
      return res.status(400).json({ error: 'The day off and the shift must be on the same day' });
    }
    if (leave.employeeId === shift.employeeId) {
      return res.status(400).json({ error: `${shift.employee.name} cannot swap with themselves` });
    }

    // X is working and goes off; P is off and comes in.
    const X = shift.employee;
    const P = leave.employee;
    if (X.outletId !== shift.outletId || P.outletId !== shift.outletId) {
      return res.status(400).json({ error: 'Both people must work at this restaurant' });
    }
    for (const [person, reason] of [[X, 'is rostered that day'], [P, 'is on their weekly off that day']]) {
      const denied = await shiftWriteDenied(req, { outletId: shift.outletId, employeeId: person.id })
        || rosterOverrideDenied(req.user, person, reason);
      if (denied) return res.status(403).json({ error: denied });
    }

    const trades = [{ shift, goesOff: X, comesIn: P, leave }];

    if (mode === 'week') {
      // X's own weekly off elsewhere in the same Monday–Sunday week.
      const weekStart = startOfLocalDay(shift.date);
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const xOffs = await prisma.leave.findMany({
        where: { employeeId: X.id, startDate: { gte: weekStart, lt: weekEnd } },
        include: shiftWithPeople,
      });
      const otherOff = xOffs.find((l) => isWeeklyOff(l) && localDateKey(l.startDate) !== localDateKey(shift.date));
      if (!otherOff) {
        return res.status(409).json({ error: `${X.name} has no other weekly off this week to trade back` });
      }
      const otherDay = localDateKey(otherOff.startDate);
      const pShifts = await prisma.shift.findMany({
        where: { employeeId: P.id, date: localDateRange(otherDay), status: { not: 'CANCELLED' } },
        include: shiftWithPeople,
      });
      if (pShifts.length !== 1 || pShifts[0].kind !== 'RESTAURANT') {
        return res.status(409).json({
          error: `${P.name} needs exactly one restaurant shift on ${otherDay} for ${X.name} to take — `
            + `they have ${pShifts.length === 0 ? 'none' : pShifts.length > 1 ? pShifts.length : 'an ODC job'}`,
        });
      }
      trades.push({ shift: pShifts[0], goesOff: P, comesIn: X, leave: otherOff });
    }

    for (const t of trades) {
      const day = localDateRange(t.shift.date);

      // The person going off must be left with nothing else that day.
      const [otherShifts, otherLeave] = await Promise.all([
        prisma.shift.findMany({
          where: { employeeId: t.goesOff.id, date: day, status: { not: 'CANCELLED' }, id: { not: t.shift.id } },
        }),
        prisma.leave.findMany({
          where: { employeeId: t.goesOff.id, status: 'APPROVED', startDate: { lt: day.lt }, endDate: { gte: day.gte } },
        }),
      ]);
      if (otherShifts.length) {
        const s = otherShifts[0];
        return res.status(409).json({
          error: `${t.goesOff.name} also works ${s.startTime}–${s.endTime} on ${localDateKey(t.shift.date)} — move that first`,
        });
      }
      if (otherLeave.length) {
        return res.status(409).json({ error: `${t.goesOff.name} is already on leave on ${localDateKey(t.shift.date)}` });
      }

      // The person coming in must be able to work it, with only this weekly
      // off in the way.
      const badStation = await stationDenied(t.comesIn.id, t.shift.section);
      if (badStation) return res.status(400).json({ error: badStation });
      const conflict = await shiftConflict({
        employeeId: t.comesIn.id, date: t.shift.date, startTime: t.shift.startTime,
        endTime: t.shift.endTime, kind: 'RESTAURANT',
      });
      const onlyThisOff = conflict?.code === 'ON_LEAVE'
        && conflict.leaves.every((l) => l.id === t.leave.id);
      if (conflict && !onlyThisOff) {
        return res.status(409).json({ error: conflict.error });
      }
    }

    const include = {
      employee: { select: { id: true, name: true, department: true, skills: true, avatar: true } },
      outlet: outletSelect,
    };
    const writes = await prisma.$transaction(trades.flatMap((t) => [
      prisma.shift.update({ where: { id: t.shift.id }, data: { employeeId: t.comesIn.id }, include }),
      prisma.leave.update({ where: { id: t.leave.id }, data: { employeeId: t.goesOff.id } }),
    ]));

    const [first, second] = trades;
    const offDay = (t) => localDateKey(t.shift.date);
    await prisma.notification.createMany({
      data: [
        {
          employeeId: P.id,
          type: 'SHIFT_ASSIGNED',
          title: 'Day Off Swapped',
          message: `You now work the ${describeShift(first.shift)} in place of ${X.name}`
            + (second ? `, and have ${offDay(second)} off instead.` : `. ${offDay(first)} is no longer your day off.`),
        },
        {
          employeeId: X.id,
          type: 'SHIFT_CHANGED',
          title: 'Day Off Swapped',
          message: `You are now off on ${offDay(first)} (weekly off) — ${P.name} works your shift`
            + (second ? `, and you work the ${describeShift(second.shift)} instead.` : '.'),
        },
      ],
    });

    for (const t of trades) {
      logAudit({
        action: 'SHIFT_EDIT', entity: 'Shift', entityId: t.shift.id, actor: req.user,
        details: {
          from: { employeeName: t.goesOff.name }, to: { employeeName: t.comesIn.name },
          date: localDateKey(t.shift.date), startTime: t.shift.startTime, endTime: t.shift.endTime,
          section: t.shift.section, swapOff: t.leave.id,
        },
      });
      logAudit({
        action: 'LEAVE_EDIT', entity: 'Leave', entityId: t.leave.id, actor: req.user,
        details: {
          employeeName: t.goesOff.name, weeklyOffFrom: t.comesIn.name,
          day: localDateKey(t.leave.startDate), mode,
        },
      });
    }

    res.json({
      mode,
      shifts: writes.filter((_, i) => i % 2 === 0),
      days: trades.map((t) => localDateKey(t.shift.date)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/shifts/:id
 *
 * Two different gates, decided by what is being deleted. A restaurant shift is
 * SHIFT_DELETE — Admin and up, since it leaves no record it existed. An ODC
 * assignment is the department head's own (SHIFT_ODC): they sent the person
 * out, and a job that fell through has to be removable by them.
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const existing = await prisma.shift.findUnique({
      where: { id: req.params.id },
      include: { employee: { select: { name: true, department: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Shift not found' });

    if (existing.kind === 'ODC') {
      const odc = odcDenied(req.user, existing.employee);
      if (odc) return res.status(403).json({ error: odc });
    } else if (!holdsCapability(req.user, 'SHIFT_DELETE')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const denied = await shiftWriteDenied(req, existing);
    if (denied) return res.status(403).json({ error: denied });

    await prisma.shift.delete({ where: { id: req.params.id } });

    logAudit({
      action: 'SHIFT_DELETE', entity: 'Shift', entityId: req.params.id, actor: req.user,
      details: {
        employeeName: existing.employee?.name, date: localDateKey(existing.date),
        startTime: existing.startTime, endTime: existing.endTime, section: existing.section,
        ...(existing.kind === 'ODC' ? { kind: 'ODC', note: existing.note } : {}),
      },
    });

    res.json({ message: 'Shift deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shifts/my — get current user's shifts
router.get('/my/upcoming', authenticateToken, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const shifts = await prisma.shift.findMany({
      where: {
        employeeId: req.user.id,
        date: { gte: today },
        status: 'ASSIGNED',
      },
      include: {
        outlet: { select: { name: true } },
      },
      orderBy: { date: 'asc' },
      take: 14,
    });

    res.json(shifts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
