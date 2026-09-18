import { Router } from 'express';
import prisma from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireApiKey } from '../middleware/apiKey.js';
import { importPunches } from '../engine/attendanceImport.js';
import { clockingEmployeeFilter, hasGlobalScope } from '../lib/scope.js';
import { can, holdsCapability } from '../lib/capabilities.js';
import { fetchPunches, attendanceSourceConfigured } from '../lib/attendanceSource.js';
import {
  localDateRange, localDateKey, startOfLocalDay,
  startOfLocalWeek, startOfLocalMonth,
} from '../lib/dates.js';
import { logAudit } from '../lib/audit.js';
import { DEPARTMENT_APPROVERS } from '../lib/departments.js';

const router = Router();

/**
 * Geofenced self-check-in is retired.
 *
 * Attendance is whatever the punch log in the attendance database records, and
 * two sources writing the same row cannot both be right: a self-check-in would
 * set a time the next sync then overwrites, so an employee would watch their
 * own hours change under them. Keeping one source of truth is the whole point.
 *
 * The engine is still there (server/src/engine/geoAttendance.js) and so is the
 * outlet geofence it reads, so restoring this is uncommenting two handlers —
 * but do not run both at once.
 *
 * // router.post('/check-in', authenticateToken, ...processCheckIn)
 * // router.post('/check-out', authenticateToken, ...processCheckOut)
 */

// GET /api/attendance/today — get current user's attendance today
router.get('/today', authenticateToken, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await prisma.attendance.findUnique({
      where: {
        employeeId_date: {
          employeeId: req.user.id,
          date: today,
        },
      },
    });

    res.json(attendance || { status: 'NOT_CHECKED_IN' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance — list attendance records
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { date, startDate, endDate, employee, status } = req.query;

    // Scope in the query, not after the fact. The previous version took 200
    // rows and then filtered in JS, so a staff user whose records fell outside
    // that first page saw nothing at all.
    //
    // Who may look beyond their own record was a role array local to this file,
    // which disagreed with the client's own idea of it — an Outlet Manager or
    // Head Chef got the manager table and a single row in it. It is a
    // capability now, so there is one answer and ACCESS.md states it.
    const where = {};

    if (!holdsCapability(req.user, 'ATTENDANCE_VIEW_ALL')) {
      // Your own record, always — no role filter here, or an administrator
      // looking at their own attendance would get a permanently empty page.
      where.employeeId = req.user.id;
    } else {
      // Merged into the nested object, never spread beside it: the outlet pin
      // lives *inside* the `employee` key, so assigning a fresh one would drop
      // it and show a head chef the whole organisation.
      where.employee = clockingEmployeeFilter(req);
      if (employee) where.employeeId = employee;
    }

    if (status) where.status = status;

    // Lets the approval queue ask for exactly what is outstanding rather than
    // filtering whatever the currently-displayed date range happened to return
    // — a pending day just outside the window would otherwise be invisible.
    if (req.query.overtimeStatus) where.overtimeStatus = req.query.overtimeStatus;

    // Local-day bounds — see lib/dates.js for why not `new Date(str)`.
    if (date) {
      where.date = localDateRange(date);
    } else if (startDate && endDate) {
      where.date = localDateRange(startDate, endDate);
    }

    const records = await prisma.attendance.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            // role drives who may approve the day's overtime; employeeCode is
            // how a row with no match back to the punch log is spotted.
            role: true,
            employeeCode: true,
            department: true,
            outletId: true,
            outlet: { select: { name: true, brand: { select: { name: true } } } },
          },
        },
      },
      orderBy: { date: 'desc' },
      // A restaurant is ~45 people, so a fortnight of one outlet is already
      // 600-odd rows and the old 200 silently truncated it. This is the *daily*
      // view; anything longer is what /summary exists for, so the cap is a
      // backstop rather than the thing shaping the page.
      take: 1000,
    });

    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/attendance/summary?period=week|month&startDate=&endDate=
 *
 * One row per person per week or per month: days worked, total hours, and
 * overtime split by what has been decided about it.
 *
 * Server-side because it cannot be done in the browser — a month of one
 * restaurant is ~1,350 attendance rows, well past anything worth sending just
 * to add it up. Aggregated in JS rather than by `date_trunc` in raw SQL: at a
 * few thousand rows the difference is not measurable, and this stays readable
 * and scoped by the same helpers as everything else.
 *
 * Declared before /:id-shaped routes so the literal path cannot be read as one.
 */
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const period = req.query.period === 'month' ? 'month' : 'week';
    const { startDate, endDate } = req.query;

    const where = {};
    if (!holdsCapability(req.user, 'ATTENDANCE_VIEW_ALL')) {
      where.employeeId = req.user.id;
    } else {
      where.employee = clockingEmployeeFilter(req);
      if (req.query.employee) where.employeeId = req.query.employee;
    }
    if (startDate && endDate) where.date = localDateRange(startDate, endDate);

    const rows = await prisma.attendance.findMany({
      where,
      select: {
        date: true,
        checkIn: true,
        checkOut: true,
        overtimeMinutes: true,
        overtimeStatus: true,
        employee: {
          select: {
            id: true, name: true, role: true, employeeCode: true, department: true,
            outlet: { select: { name: true } },
          },
        },
      },
      orderBy: { date: 'asc' },
    });

    const bucketStart = period === 'month' ? startOfLocalMonth : startOfLocalWeek;
    const buckets = new Map();

    for (const r of rows) {
      const key = `${r.employee.id}::${localDateKey(bucketStart(r.date))}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          employee: r.employee,
          period: localDateKey(bucketStart(r.date)),
          days: 0,
          completeDays: 0,
          minutes: 0,
          overtimeMinutes: 0,
          overtimeApproved: 0,
          overtimePending: 0,
          overtimeRejected: 0,
          missingPunchOut: 0,
        });
      }
      const b = buckets.get(key);

      b.days += 1;
      if (r.checkIn && r.checkOut) {
        b.completeDays += 1;
        b.minutes += Math.floor((r.checkOut - r.checkIn) / 60000);
      } else if (r.checkIn) {
        // Counted rather than silently dropped: a day nobody closed is the one
        // thing in here that needs a person to go and fix it.
        b.missingPunchOut += 1;
      }

      b.overtimeMinutes += r.overtimeMinutes || 0;
      if (r.overtimeStatus === 'APPROVED') b.overtimeApproved += r.overtimeMinutes || 0;
      else if (r.overtimeStatus === 'PENDING') b.overtimePending += r.overtimeMinutes || 0;
      else if (r.overtimeStatus === 'REJECTED') b.overtimeRejected += r.overtimeMinutes || 0;
    }

    // Newest period first, then by name — the order a payroll run reads in.
    const summary = [...buckets.values()].sort(
      (a, b) => b.period.localeCompare(a.period) || a.employee.name.localeCompare(b.employee.name)
    );

    res.json({ period, rows: summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance/stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Both sides of the ratio count the same people. Administration roles never
    // clock in, so counting them in `total` left notCheckedIn permanently
    // inflated by the number of admin accounts.
    const clocking = clockingEmployeeFilter(req);
    const scope = { employee: clocking };
    const day = { gte: today, lt: tomorrow };

    const [checkedIn, late, absent, total] = await Promise.all([
      prisma.attendance.count({
        where: { ...scope, date: day, status: { in: ['CHECKED_IN', 'CHECKED_OUT'] } },
      }),
      prisma.attendance.count({ where: { ...scope, date: day, status: 'LATE' } }),
      prisma.attendance.count({ where: { ...scope, date: day, status: 'ABSENT' } }),
      prisma.employee.count({ where: { isActive: true, ...clocking } }),
    ]);

    res.json({
      checkedIn,
      late,
      absent,
      total,
      // LATE is a form of present, so it is counted here rather than left in
      // the not-checked-in bucket.
      present: checkedIn + late,
      notCheckedIn: Math.max(0, total - checkedIn - late - absent),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * One audit row for the import itself, plus one per overtime decision the new
 * punches invalidated.
 *
 * The per-decision rows matter because overtime lives in columns rather than
 * its own table: the columns always agree with the punches they came from, but
 * they keep no history. Without this there would be no record that a chef's
 * approval was ever reopened, or what it had been for.
 */
function auditImport(summary, source) {
  logAudit({
    action: 'ATTENDANCE_IMPORT',
    entity: 'Attendance',
    details: {
      source,
      processed: summary.processed,
      daysWritten: summary.daysWritten,
      unmatched: summary.unmatched.length,
      reopened: summary.reopened.length,
    },
  });

  for (const r of summary.reopened) {
    logAudit({
      action: 'OVERTIME_RECOMPUTED',
      entity: 'Attendance',
      details: { source, ...r },
    });
  }
}

/**
 * POST /api/attendance/import
 *
 * Bridges an external attendance system (KGAPI's raw biometric/mobile-app
 * punch log) into Shiftly's own Attendance table. No JWT — this is called by
 * an unattended script, not a signed-in user — gated instead by its own API
 * key, kept separate from the public read API's key so a leaked read-only
 * key can never be used to write attendance data.
 *
 * Body is the raw punch array as KGAPI returns it under `GetAttandance`, e.g.
 * `[{ emp_name, edatetime, evtsourcedet, userid }, ...]`.
 */
router.post('/import', requireApiKey('ATTENDANCE_IMPORT_KEYS'), async (req, res) => {
  try {
    const punches = req.body;
    if (!Array.isArray(punches)) {
      return res.status(400).json({ error: 'Body must be an array of punch events' });
    }

    const summary = await importPunches(prisma, punches, { source: 'KGAPI' });

    auditImport(summary, 'KGAPI');

    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Pull from the attendance database and import what comes back.
 *
 * One definition behind two doors: the button a person presses, and the
 * scheduled call from outside. The flag is enough of a lock because this runs
 * on a single instance — two overlapping pulls would write identical data, but
 * they would also race each other's upserts into a unique-constraint error and
 * double the load for nothing.
 */
let syncing = false;

async function runSync({ from, to }) {
  if (!attendanceSourceConfigured()) {
    const err = new Error('Attendance source is not configured');
    err.status = 503;
    throw err;
  }
  if (syncing) {
    const err = new Error('A sync is already running');
    err.status = 409;
    throw err;
  }

  syncing = true;
  try {
    const punches = await fetchPunches({ from, to });
    const summary = await importPunches(prisma, punches, { source: 'attendance database' });
    auditImport(summary, 'attendance-db');
    return { from, to, ...summary };
  } finally {
    syncing = false;
  }
}

/**
 * Yesterday and today by default.
 *
 * Yesterday because a night shift's closing punch lands after midnight and
 * because devices upload late; capped because a long backfill belongs in the
 * script, where nothing is waiting on the response.
 */
const MAX_SYNC_DAYS = 7;

function syncRange(query) {
  const today = localDateKey(new Date());
  const to = query.to || today;
  const from = query.from || localDateKey(new Date(Date.now() - 86400000));

  const span = (startOfLocalDay(to) - startOfLocalDay(from)) / 86400000;
  if (span < 0) throw Object.assign(new Error('from must not be after to'), { status: 400 });
  if (span >= MAX_SYNC_DAYS) {
    throw Object.assign(
      new Error(`Range is limited to ${MAX_SYNC_DAYS} days — use the sync script for a longer backfill`),
      { status: 400 }
    );
  }
  return { from, to };
}

function sendSyncError(res, err) {
  res.status(err.status || 500).json({ error: err.message });
}

// POST /api/attendance/sync — the button.
// Declared before any /:id route so the literal path cannot be read as an id.
router.post('/sync', authenticateToken, can('ATTENDANCE_SYNC'), async (req, res) => {
  try {
    res.json(await runSync(syncRange(req.body || {})));
  } catch (err) {
    sendSyncError(res, err);
  }
});

/**
 * POST /api/attendance/sync-job — the same pull, for the scheduler.
 *
 * An external cron holds no session, and inventing a service account to give it
 * one would be a second way in. It uses the same API key as the import bridge:
 * the same integration boundary, already failing closed when unset and already
 * fingerprinting the caller into the request log.
 */
router.post('/sync-job', requireApiKey('ATTENDANCE_IMPORT_KEYS'), async (req, res) => {
  try {
    res.json(await runSync(syncRange(req.body || {})));
  } catch (err) {
    sendSyncError(res, err);
  }
});

/**
 * Mirrors leaveApprovalDenied() in leave.routes.js — overtime is routed to the
 * same people by the same rule, so the two should not drift apart.
 *
 * HR/ADMIN/SUPER_ADMIN may act on any record. A department head may act only on
 * their own department, at their own restaurant. Returns an error string, or
 * null when the action is allowed.
 *
 * An OUTLET_MANAGER reaches none of this — the route guard turns them away.
 * They see every hour worked at their restaurant and sign off none of it, which
 * is the whole distinction between them and a Master of House.
 *
 * Unlike the leave version this also refuses to let anyone sign off their own
 * hours. Heads accrue no overtime today, so the case should not arise — but
 * that is an exemption in an engine, and it should not be the only thing
 * standing between a manager and their own approval.
 */
function overtimeApprovalDenied(req, record) {
  if (record.employeeId === req.user.id) {
    return 'You cannot approve your own overtime';
  }
  if (hasGlobalScope(req.user)) return null;
  if (record.employee.outletId !== req.user.outletId) {
    return 'You can only act on overtime for your own outlet';
  }
  if (DEPARTMENT_APPROVERS[record.employee.department] !== req.user.role) {
    return 'You can only approve overtime for your own department';
  }
  return null;
}

/** Shared by the approve and reject routes, which differ only in the verb. */
async function decideOvertime(req, res, decision) {
  const record = await prisma.attendance.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      date: true,
      employeeId: true,
      overtimeStatus: true,
      overtimeMinutes: true,
      employee: { select: { name: true, outletId: true, department: true } },
    },
  });

  if (!record) return res.status(404).json({ error: 'Attendance record not found' });
  if (record.overtimeStatus !== 'PENDING') {
    return res.status(400).json({
      error: record.overtimeStatus
        ? `This overtime is already ${record.overtimeStatus.toLowerCase()}`
        : 'This day has no overtime awaiting a decision',
    });
  }

  const denied = overtimeApprovalDenied(req, record);
  if (denied) return res.status(403).json({ error: denied });

  const updated = await prisma.attendance.update({
    where: { id: record.id },
    data: {
      overtimeStatus: decision,
      // Pinned to the figure that was actually signed off, so a later re-import
      // can tell whether the punches still say the same thing.
      overtimeMinutesAtDecision: record.overtimeMinutes,
      overtimeApprovedBy: req.user.id,
      overtimeDecidedAt: new Date(),
    },
  });

  logAudit({
    action: decision === 'APPROVED' ? 'OVERTIME_APPROVE' : 'OVERTIME_REJECT',
    entity: 'Attendance',
    entityId: record.id,
    actor: req.user,
    details: {
      employeeName: record.employee.name,
      date: localDateKey(record.date),
      minutes: record.overtimeMinutes,
    },
  });

  res.json(updated);
}

// POST /api/attendance/:id/overtime/approve
router.post('/:id/overtime/approve', authenticateToken, can('OVERTIME_APPROVE'), async (req, res) => {
  try {
    await decideOvertime(req, res, 'APPROVED');
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/attendance/:id/overtime/reject
router.post('/:id/overtime/reject', authenticateToken, can('OVERTIME_REJECT'), async (req, res) => {
  try {
    await decideOvertime(req, res, 'REJECTED');
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
