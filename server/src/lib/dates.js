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

/** YYYY-MM-DD from a Date's local parts (not toISOString, which shifts the day). */
export function localDateKey(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
