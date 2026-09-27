import { GLOBAL_SCOPE_ROLES } from '../lib/scope.js';
import { startOfLocalDay } from '../lib/dates.js';

/**
 * Overtime against a nine-hour day, with two and a half hours of grace.
 *
 * The working day is nine hours whatever time it starts, and a restaurant day
 * regularly runs a little past it — so nothing is raised until the day reaches
 * eleven and a half. Once it does, the overtime is everything past the ninth
 * hour, the grace included: an 11h 31m day is 2h 31m, a 13h day is 4h. A
 * department head signs it off. Hours worked are the closed in/out sessions
 * added up, so a break between them is not paid (see pairSessions).
 *
 * This module is deliberately pure: no database, no clock beyond the `now` it is
 * given. It is the piece that decides what someone gets paid for, so it should
 * be readable and testable on its own.
 */

/** The standard day. Nine hours, regardless of when the shift starts or ends. */
export const WORKDAY_MINUTES = 9 * 60;

/**
 * Roles that accrue no overtime.
 *
 * The two department heads are the people who *approve* overtime, so they do not
 * raise it against themselves. Administration roles never clock in at all.
 *
 * Note this is a different set from the roles hidden from the attendance list
 * (clockingEmployeeFilter in lib/scope.js): a head chef still appears there with
 * their hours, they simply never accrue.
 */
export const OVERTIME_EXEMPT_ROLES = [...GLOBAL_SCOPE_ROLES, 'MASTER_OF_HOUSE', 'HEAD_CHEF'];

/**
 * The grace: overtime smaller than this is not overtime.
 *
 * A service finishes when the last table leaves, and twenty minutes past nine
 * hours is the tail of an ordinary day rather than a claim anyone should sign
 * off. Below this the day reads as a plain day — no minutes, nothing queued.
 *
 * Note what it does *not* do: once the day passes it, the grace is part of the
 * claim rather than deducted from it. The minutes are counted from the ninth
 * hour, so the smallest overtime ever recorded is this value itself.
 */
export const MIN_OVERTIME_MINUTES = 150;

/**
 * A span this long is a missed punch-out, not a day's work.
 *
 * Someone who forgets to tap out and is caught by a security or cleaning punch
 * at 23:55 would otherwise raise a six-hour overtime claim into a chef's queue.
 * The minutes are still recorded; the status is left null so it shows as
 * needing a human to look rather than as something to approve.
 */
export const IMPLAUSIBLE_MINUTES = 16 * 60;

/** Minutes between two instants, floored — a part-minute is not overtime. */
function minutesBetween(from, to) {
  return Math.floor((to.getTime() - from.getTime()) / 60000);
}

/**
 * Decide the five overtime columns for one attendance day.
 *
 * `existing` is the row as currently stored, or null on first write. It matters
 * because of approvals: a scheduled sync re-imports the same days every night,
 * and recomputing blindly would send every approved day back to PENDING, so the
 * queue would never empty and a signature would mean nothing. The rule is to
 * compare against `overtimeMinutesAtDecision` — what was actually approved —
 * and only reopen a decision when the punches genuinely changed.
 *
 * Returns `{ fields, reopened }`. `reopened` carries the before/after for the
 * caller to write an audit trail, which is the one thing columns cannot keep
 * that a separate table would have.
 */
export function resolveOvertime({
  checkIn, checkOut, role, date, existing = null, now = new Date(),
  worked: workedGiven = null, missingOutPunch = false,
}) {
  const idle = {
    overtimeMinutes: 0,
    overtimeStatus: null,
    overtimeMinutesAtDecision: null,
    overtimeApprovedBy: null,
    overtimeDecidedAt: null,
    overtimeReason: null,
  };

  // An open day has no span to measure yet.
  if (!checkIn || !checkOut) return { fields: idle, reopened: null };
  if (OVERTIME_EXEMPT_ROLES.includes(role)) return { fields: idle, reopened: null };

  // Session-summed minutes when the importer knows them (breaks unpaid, as in
  // Neon); first punch to last for a self check-in, which has only two times.
  const worked = workedGiven ?? minutesBetween(checkIn, checkOut);
  const overtimeMinutes = Math.max(0, worked - WORKDAY_MINUTES);
  // Under the minimum it is not recorded and never queues, so the day looks
  // exactly like one that finished on time.
  if (overtimeMinutes < MIN_OVERTIME_MINUTES) return { fields: idle, reopened: null };

  // A day still under way would raise an approval item that then changes under
  // the approver as the evening's punches arrive. Only settled days queue.
  const settled = startOfLocalDay(date) < startOfLocalDay(now);
  const plausible = worked <= IMPLAUSIBLE_MINUTES;
  const effectiveFrom = process.env.OVERTIME_EFFECTIVE_FROM;
  const inScope = !effectiveFrom || startOfLocalDay(date) >= startOfLocalDay(effectiveFrom);

  // A day with an unclosed session has hours missing, so its overtime is not
  // a number anyone should sign off yet — it is shown for review instead, the
  // same way an implausible span is, until the punch is corrected.
  const queueable = settled && plausible && inScope && !missingOutPunch;

  // Nothing decided yet: this is a fresh claim, or an update to a pending one.
  const decided = existing?.overtimeStatus === 'APPROVED' || existing?.overtimeStatus === 'REJECTED';

  if (!decided) {
    return {
      fields: {
        overtimeMinutes,
        overtimeStatus: queueable ? 'PENDING' : null,
        overtimeMinutesAtDecision: null,
        overtimeApprovedBy: null,
        overtimeDecidedAt: null,
        overtimeReason: null,
      },
      reopened: null,
    };
  }

  // Already approved or rejected. If the punches still say the same thing, the
  // decision stands untouched — this is the case that runs every single night.
  if (existing.overtimeMinutesAtDecision === overtimeMinutes) {
    return {
      fields: {
        overtimeMinutes,
        overtimeStatus: existing.overtimeStatus,
        overtimeMinutesAtDecision: existing.overtimeMinutesAtDecision,
        overtimeApprovedBy: existing.overtimeApprovedBy,
        overtimeDecidedAt: existing.overtimeDecidedAt,
        overtimeReason: existing.overtimeReason ?? null,
      },
      reopened: null,
    };
  }

  // The punches changed after a decision. Signing off 90 minutes is not signing
  // off 150, so it goes back to the approver — and leaves a trail saying why.
  return {
    fields: {
      overtimeMinutes,
      overtimeStatus: queueable ? 'PENDING' : null,
      overtimeMinutesAtDecision: null,
      overtimeApprovedBy: null,
      overtimeDecidedAt: null,
      overtimeReason: null,
    },
    reopened: {
      was: existing.overtimeMinutesAtDecision,
      now: overtimeMinutes,
      priorStatus: existing.overtimeStatus,
      priorApprovedBy: existing.overtimeApprovedBy,
      priorReason: existing.overtimeReason ?? null,
    },
  };
}

/** Hours worked on a completed day, or null while it is still open. */
export function workedMinutes({ checkIn, checkOut, workedMinutes: stored = null }) {
  if (stored != null) return stored;
  if (!checkIn || !checkOut) return null;
  return minutesBetween(checkIn, checkOut);
}

/**
 * A day's punches as Neon pairs them: 1–2, 3–4, … Only closed pairs count
 * toward the hours, so a break between sessions is unpaid and an odd final
 * punch is an open session rather than the end of the day.
 *
 * `times` must be sorted. Returns the fields the Attendance row stores.
 */
export function pairSessions(times) {
  // Summed in milliseconds and floored once, as Neon sums seconds — flooring
  // each session would drift a minute per break.
  let workedMs = 0;
  let closed = 0;
  for (let i = 0; i + 1 < times.length; i += 2) {
    workedMs += times[i + 1].getTime() - times[i].getTime();
    closed += 1;
  }
  const worked = Math.floor(workedMs / 60000);
  const missingOutPunch = times.length % 2 === 1;
  return {
    checkIn: times[0] || null,
    // Neon's last_out: the out of the last *closed* session. With an odd count
    // the final punch opened a session, so it is not a check-out.
    checkOut: closed > 0 ? times[closed * 2 - 1] : null,
    workedMinutes: closed > 0 ? worked : null,
    sessions: Math.ceil(times.length / 2),
    missingOutPunch,
  };
}
