/**
 * Local-day helpers for date-range queries.
 *
 * Shift and Attendance rows are written at *local* midnight (the seeder and the
 * check-in flow both use `setHours(0,0,0,0)`), which Postgres stores as an
 * instant — 18:30Z the previous day at UTC+05:30.
 *
 * `new Date('2026-07-27')` parses a date-only string as **UTC** midnight, which
 * is 05:30 local. Used as a `gte` bound that is *after* the row it should match,
 * so the first day of every range was silently dropped: a week view showed six
 * days and reported the seventh as empty.
 *
 * Always bound queries with these instead of `new Date(str)`.
 */

/** Midnight local time on the given YYYY-MM-DD. */
export function startOfLocalDay(value) {
  if (value instanceof Date) {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Midnight local time on the day *after* the given date — an exclusive upper bound. */
export function endOfLocalDayExclusive(value) {
  const d = startOfLocalDay(value);
  d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Half-open local-day range `{ gte, lt }` for Prisma.
 * Pass one date for a single day, or two for an inclusive span.
 */
export function localDateRange(startDate, endDate = startDate) {
  return {
    gte: startOfLocalDay(startDate),
    lt: endOfLocalDayExclusive(endDate),
  };
}

/**
 * Which working day a punch belongs to.
 *
 * A restaurant's day does not end at midnight. An 18:00–02:00 shift punches out
 * on the calendar day *after* it started, and on a plain local-midnight boundary
 * that produced two wrong rows: the starting day kept a lone punch — no
 * check-out, so no hours and no overtime — while the next morning gained a
 * phantom record showing a 02:00 arrival, which determineAttendanceStatus then
 * marked LATE against that day's breakfast shift, and the dashboard counted as
 * someone present.
 *
 * ATTENDANCE_DAY_CUTOFF_HOUR is the hour a new working day begins: a punch
 * before it is attributed to the previous day. 0 is the old behaviour.
 *
 * This is effectively part of the schema, not a tunable — the result is half of
 * Attendance's @@unique([employeeId, date]), so changing it after rows exist
 * makes the next import write a *second* row for the same real shift rather
 * than updating the first.
 */
export function attendanceDayFor(time) {
  const cutoff = attendanceCutoffHour();

  const day = startOfLocalDay(time);
  if (cutoff > 0 && time.getHours() < cutoff) {
    day.setDate(day.getDate() - 1);
  }
  return day;
}

/**
 * Monday of the local week containing `value`.
 *
 * Monday-first to match the rest of the app — Shift Planning builds its week
 * with `startOfWeek(..., { weekStartsOn: 1 })`, and a weekly attendance total
 * that ran Sunday-to-Saturday would not line up with the roster it is measured
 * against.
 */
export function startOfLocalWeek(value) {
  const d = startOfLocalDay(value);
  // getDay() is Sunday-0; shift so Monday is 0 and Sunday is 6.
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** First day of the local calendar month containing `value`. */
export function startOfLocalMonth(value) {
  const d = startOfLocalDay(value);
  d.setDate(1);
  return d;
}

/**
 * ATTENDANCE_DAY_CUTOFF_HOUR, read once and clamped to 0–12.
 *
 * Shared by attendanceDayFor() and by the attendance-source query, which has to
 * fetch exactly the punches belonging to a range of working days. If the two
 * parsed it separately, a malformed value could be clamped one way in the
 * fetch and another in the grouping.
 */
export function attendanceCutoffHour() {
  const raw = Number(process.env.ATTENDANCE_DAY_CUTOFF_HOUR ?? 0);
  return Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 0), 12) : 0;
}

/** YYYY-MM-DD from a Date's local parts (not toISOString, which shifts the day). */
export function localDateKey(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
