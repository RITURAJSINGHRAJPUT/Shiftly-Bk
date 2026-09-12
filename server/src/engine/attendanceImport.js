import { startOfLocalDay } from '../lib/dates.js';
import { determineAttendanceStatus } from './geoAttendance.js';

/**
 * KGAPI timestamps look like "2026-07-02 08:41:21.0" — space separated, no
 * timezone. Parsed manually rather than via `new Date(string)`, for the same
 * reason dates.js avoids that for date-only strings: non-ISO string parsing
 * is engine-dependent. Treated as the same "local" wall-clock time every
 * other DateTime in this app already assumes.
 */
function parseKgapiTimestamp(edatetime) {
  const [datePart, timePart] = String(edatetime).split(' ');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm, ss] = (timePart || '00:00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, Math.trunc(ss) || 0);
}

/**
 * Turn KGAPI's raw punch log into Shiftly's Attendance shape.
 *
 * The external system has no concept of "check-in" vs "check-out" — every tap
 * is just a punch. Shiftly's Attendance table is one row per employee per day
 * with two DateTime columns, so each employee's punches for a day are
 * collapsed: earliest punch -> checkIn, latest -> checkOut (only set once
 * there's more than one punch — a single punch is still mid-shift, not a
 * completed day). employeeCode is the join key against KGAPI's `userid`; it
 * has to be set on the Employee record beforehand — this only matches
 * employees who already have one.
 *
 * `punches` is the raw array from KGAPI's `GetAttandance` field, e.g.
 * `[{ emp_name, edatetime, evtsourcedet, userid }, ...]`.
 */
export async function importPunches(prisma, punches) {
  const byEmployeeDay = new Map();

  for (const punch of punches) {
    const userId = punch.userid;
    if (!userId || !punch.edatetime) continue;

    const time = parseKgapiTimestamp(punch.edatetime);
    const day = startOfLocalDay(time);
    const key = `${userId}::${day.getTime()}`;

    if (!byEmployeeDay.has(key)) {
      byEmployeeDay.set(key, { userId, day, punches: [] });
    }
    byEmployeeDay.get(key).punches.push({ time, source: punch.evtsourcedet || null });
  }

  const userIds = [...new Set(punches.map((p) => p.userid).filter(Boolean))];
  const employees = await prisma.employee.findMany({
    where: { employeeCode: { in: userIds } },
    select: { id: true, employeeCode: true },
  });
  const employeeIdByCode = new Map(employees.map((e) => [e.employeeCode, e.id]));
  const unmatchedUserIds = userIds.filter((id) => !employeeIdByCode.has(id));

  let daysWritten = 0;
  for (const { userId, day, punches: dayPunches } of byEmployeeDay.values()) {
    const employeeId = employeeIdByCode.get(userId);
    if (!employeeId) continue;

    dayPunches.sort((a, b) => a.time - b.time);
    const first = dayPunches[0];
    const last = dayPunches[dayPunches.length - 1];
    const hasCheckOut = dayPunches.length > 1;

    const status = await determineAttendanceStatus(prisma, employeeId, day, first.time, hasCheckOut);
    const sources = [...new Set(dayPunches.map((p) => p.source).filter(Boolean))];
    const notes = sources.length
      ? `Imported from KGAPI (${sources.join(', ')})`
      : 'Imported from KGAPI (biometric device)';

    const data = {
      checkIn: first.time,
      checkOut: hasCheckOut ? last.time : null,
      // No GPS from an external device — presence is verified by the device
      // itself, so this isn't a geofence violation the way a missing/failed
      // self-check-in coordinate would be.
      withinRange: true,
      status,
      notes,
    };

    await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date: day } },
      update: data,
      create: { employeeId, date: day, ...data },
    });
    daysWritten++;
  }

  return {
    processed: punches.length,
    daysWritten,
    unmatchedUserIds,
  };
}
