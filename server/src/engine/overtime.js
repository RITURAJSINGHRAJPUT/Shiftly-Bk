import { GLOBAL_SCOPE_ROLES } from '../lib/scope.js';
import { startOfLocalDay } from '../lib/dates.js';

/**
 * Overtime against a fixed nine-hour day.
 *
 * The working day is nine hours whatever time it starts: every minute past that
 * is overtime, and a department head signs it off. Hours worked are measured
 * from the first punch of the day to the last, breaks included — the punch log
 * has no concept of a break, and the importer keeps only the outer two punches.
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
export function resolveOvertime({ checkIn, checkOut, role, date, existing = null, now = new Date() }) {
  const idle = {
    overtimeMinutes: 0,
    overtimeStatus: null,
    overtimeMinutesAtDecision: null,
    overtimeApprovedBy: null,
    overtimeDecidedAt: null,
  };

  // An open day has no span to measure yet.
  if (!checkIn || !checkOut) return { fields: idle, reopened: null };
  if (OVERTIME_EXEMPT_ROLES.includes(role)) return { fields: idle, reopened: null };

  const worked = minutesBetween(checkIn, checkOut);
  const overtimeMinutes = Math.max(0, worked - WORKDAY_MINUTES);
  if (overtimeMinutes === 0) return { fields: idle, reopened: null };

  // A day still under way would raise an approval item that then changes under
  // the approver as the evening's punches arrive. Only settled days queue.
  const settled = startOfLocalDay(date) < startOfLocalDay(now);
  const plausible = worked <= IMPLAUSIBLE_MINUTES;
  const effectiveFrom = process.env.OVERTIME_EFFECTIVE_FROM;
  const inScope = !effectiveFrom || startOfLocalDay(date) >= startOfLocalDay(effectiveFrom);

  const queueable = settled && plausible && inScope;

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
    },
    reopened: {
      was: existing.overtimeMinutesAtDecision,
      now: overtimeMinutes,
      priorStatus: existing.overtimeStatus,
      priorApprovedBy: existing.overtimeApprovedBy,
    },
  };
}

/** Hours worked on a completed day, or null while it is still open. */
export function workedMinutes({ checkIn, checkOut }) {
  if (!checkIn || !checkOut) return null;
  return minutesBetween(checkIn, checkOut);
}
