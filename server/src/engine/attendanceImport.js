import { attendanceDayFor, localDateKey } from '../lib/dates.js';
import { statusFor } from './geoAttendance.js';
import { resolveOvertime } from './overtime.js';

/**
 * Punch-log timestamps look like "2026-07-02 08:41:21.0" — space separated, no
 * timezone. Parsed manually rather than via `new Date(string)`, for the same
 * reason dates.js avoids that for date-only strings: non-ISO string parsing
 * is engine-dependent. Treated as the same "local" wall-clock time every
 * other DateTime in this app already assumes.
 *
 * Tolerates a Date too, because a Postgres `timestamp` column read through the
 * `pg` driver arrives as one — and `String(aDate).split(' ')[0]` would be the
 * weekday name, which parses to NaN and poisons the day key.
 */
function parsePunchTimestamp(edatetime) {
  if (edatetime instanceof Date) return edatetime;

  const [datePart, timePart] = String(edatetime).split(' ');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm, ss] = (timePart || '00:00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, Math.trunc(ss) || 0);
}

/**
 * Two taps this close together are one event.
 *
 * Biometric readers double-register constantly — a finger held a moment too
 * long, a second try when the first beep was missed. Without this, two taps
 * three seconds apart satisfy "more than one punch" and the day is recorded as
 * a *completed* shift of zero minutes: the dashboard counts the person present
 * all day, and the hours say they worked none.
 */
const DEDUPE_WINDOW_MS = 120 * 1000;

function dedupe(punches) {
  const sorted = [...punches].sort((a, b) => a.time - b.time);
  return sorted.filter((p, i) => i === 0 || p.time - sorted[i - 1].time > DEDUPE_WINDOW_MS);
}

/**
 * Turn a raw punch log into Shiftly's Attendance shape.
 *
 * The external system has no concept of "check-in" vs "check-out" — every tap
 * is just a punch. Shiftly's Attendance table is one row per employee per
 * working day with two DateTime columns, so each employee's punches for a day
 * are collapsed: earliest punch -> checkIn, latest -> checkOut (only once
 * there's more than one distinct punch — a single punch is still mid-shift,
 * not a completed day). employeeCode is the join key against the log's
 * `userid`; it has to be set on the Employee record beforehand.
 *
 * `punches` is the raw array, e.g.
 * `[{ emp_name, edatetime, evtsourcedet, userid }, ...]`.
 *
 * Returns `{ processed, daysWritten, unmatched, reopened }`. `unmatched` carries
 * names and punch counts, not bare ids, because its whole purpose is to be
 * handed to someone who has to decide which Shiftly employee each one is.
 * `reopened` lists overtime decisions invalidated by changed punches, for the
 * caller to write to the audit log.
 */
export async function importPunches(prisma, punches, { source = 'external attendance system' } = {}) {
  const byEmployeeDay = new Map();
  const nameByUserId = new Map();
  const punchCountByUserId = new Map();

  for (const punch of punches) {
    const userId = punch.userid == null ? null : String(punch.userid);
    if (!userId || !punch.edatetime) continue;

    const time = parsePunchTimestamp(punch.edatetime);
    if (Number.isNaN(time.getTime())) continue;

    if (punch.emp_name && !nameByUserId.has(userId)) nameByUserId.set(userId, punch.emp_name);
    punchCountByUserId.set(userId, (punchCountByUserId.get(userId) || 0) + 1);

    const day = attendanceDayFor(time);
    const key = `${userId}::${day.getTime()}`;

    if (!byEmployeeDay.has(key)) {
      byEmployeeDay.set(key, { userId, day, punches: [] });
    }
    byEmployeeDay.get(key).punches.push({ time, source: punch.evtsourcedet || null });
  }

  const userIds = [...punchCountByUserId.keys()];
  const employees = await prisma.employee.findMany({
    where: { employeeCode: { in: userIds } },
    select: { id: true, employeeCode: true, role: true },
  });
  const employeeByCode = new Map(employees.map((e) => [e.employeeCode, e]));

  const unmatched = userIds
    .filter((id) => !employeeByCode.has(id))
    .map((userid) => ({
      userid,
      name: nameByUserId.get(userid) || null,
      punchCount: punchCountByUserId.get(userid) || 0,
    }));

  /**
   * Remember who the feed says each code belongs to.
   *
   * These names were being read and discarded on every run, which left a
   * manager typing a code with no way to confirm whose it was. Kept for every
   * code, not only the unmatched ones, so the same lookup can also answer
   * "this code is already someone's".
   */
  const lastSeenByUserId = new Map();
  for (const { userId, punches: ps } of byEmployeeDay.values()) {
    const latest = ps.reduce((a, b) => (a.time > b.time ? a : b)).time;
    if (!lastSeenByUserId.has(userId) || latest > lastSeenByUserId.get(userId)) {
      lastSeenByUserId.set(userId, latest);
    }
  }
  for (const userid of userIds) {
    const identity = {
      name: nameByUserId.get(userid) || null,
      punchCount: punchCountByUserId.get(userid) || 0,
      lastSeen: lastSeenByUserId.get(userid) || new Date(),
    };
    await prisma.punchIdentity.upsert({
      where: { userid },
      update: identity,
      create: { userid, ...identity },
    });
  }

  // Everything the loop needs, in two queries rather than two per employee-day.
  const days = [...byEmployeeDay.values()].map((e) => e.day);
  const employeeIds = employees.map((e) => e.id);
  const dayBounds = days.length
    ? { gte: new Date(Math.min(...days.map((d) => d.getTime()))),
        lte: new Date(Math.max(...days.map((d) => d.getTime()))) }
    : null;

  const [shifts, existingRows] = dayBounds && employeeIds.length
    ? await Promise.all([
        prisma.shift.findMany({
          where: { employeeId: { in: employeeIds }, date: dayBounds, status: 'ASSIGNED' },
          select: { employeeId: true, date: true, startTime: true },
        }),
        prisma.attendance.findMany({
          where: { employeeId: { in: employeeIds }, date: dayBounds },
          select: {
            employeeId: true, date: true, overtimeStatus: true,
            overtimeMinutesAtDecision: true, overtimeApprovedBy: true, overtimeDecidedAt: true,
          },
        }),
      ])
    : [[], []];

  const rowKey = (employeeId, day) => `${employeeId}::${localDateKey(day)}`;
  const shiftByKey = new Map(shifts.map((s) => [rowKey(s.employeeId, s.date), s]));
  const existingByKey = new Map(existingRows.map((r) => [rowKey(r.employeeId, r.date), r]));

  let daysWritten = 0;
  const reopened = [];

  for (const { userId, day, punches: rawDayPunches } of byEmployeeDay.values()) {
    const employee = employeeByCode.get(userId);
    if (!employee) continue;

    const dayPunches = dedupe(rawDayPunches);
    const first = dayPunches[0];
    const last = dayPunches[dayPunches.length - 1];
    const hasCheckOut = dayPunches.length > 1;

    const key = rowKey(employee.id, day);
    const status = statusFor(shiftByKey.get(key), day, first.time, hasCheckOut);

    const checkIn = first.time;
    const checkOut = hasCheckOut ? last.time : null;

    const existing = existingByKey.get(key) || null;
    const { fields: overtime, reopened: wasReopened } = resolveOvertime({
      checkIn,
      checkOut,
      role: employee.role,
      date: day,
      existing,
    });

    if (wasReopened) {
      reopened.push({ employeeId: employee.id, date: localDateKey(day), ...wasReopened });
    }

    const sources = [...new Set(dayPunches.map((p) => p.source).filter(Boolean))];
    const notes = sources.length
      ? `Imported from ${source} (${sources.join(', ')})`
      : `Imported from ${source}`;

    const data = {
      checkIn,
      checkOut,
      // No GPS from an external device — presence is verified by the device
      // itself, so this isn't a geofence violation the way a missing/failed
      // self-check-in coordinate would be.
      withinRange: true,
      status,
      notes,
      // Written in the same statement as the punches they are derived from, so
      // a row can never hold new times next to stale overtime.
      ...overtime,
    };

    await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: employee.id, date: day } },
      update: data,
      create: { employeeId: employee.id, date: day, ...data },
    });
    daysWritten++;
  }

  return {
    processed: punches.length,
    daysWritten,
    unmatched,
    reopened,
  };
}
