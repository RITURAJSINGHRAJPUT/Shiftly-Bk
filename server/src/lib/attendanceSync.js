import prisma from '../db.js';
import { importPunches } from '../engine/attendanceImport.js';
import { fetchPunches, attendanceSourceConfigured } from './attendanceSource.js';
import { localDateKey, startOfLocalDay } from './dates.js';
import { logAudit } from './audit.js';

/**
 * Getting punches from the attendance database into Shiftly.
 *
 * Three doors lead here — the HR "Sync now" button, the nightly scheduler, and
 * the page itself asking to be brought up to date — and they share one lock.
 * Kept out of the router so the third door does not have to be a route handler
 * calling another route's internals.
 */

/**
 * One audit row for the import itself, plus one per overtime decision the new
 * punches invalidated.
 *
 * The per-decision rows matter because overtime lives in columns rather than
 * its own table: the columns always agree with the punches they came from, but
 * they keep no history. Without this there would be no record that a chef's
 * approval was ever reopened, or what it had been for.
 */
export function auditImport(summary, source) {
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
 * The flag is enough of a lock because this runs on a single instance — two
 * overlapping pulls would write identical data, but they would also race each
 * other's upserts into a unique-constraint error and double the load for
 * nothing.
 */
let syncing = false;

function notConfigured() {
  return Object.assign(new Error('Attendance source is not configured'), { status: 503 });
}

/** Holds the lock for the length of `work`, or refuses if someone else has it. */
async function locked(work) {
  if (syncing) {
    throw Object.assign(new Error('A sync is already running'), { status: 409 });
  }
  syncing = true;
  try {
    return await work();
  } finally {
    syncing = false;
  }
}

/** One fetch-and-import. `userIds` narrows it to those codes. */
async function pull({ from, to, userIds }) {
  const punches = await fetchPunches({ from, to, userIds });
  const summary = await importPunches(prisma, punches, { source: 'attendance database' });
  auditImport(summary, 'attendance-db');
  return summary;
}

/** A range the caller chose — the button and the scheduler. */
export async function runSync({ from, to }) {
  if (!attendanceSourceConfigured()) throw notConfigured();
  return locked(async () => ({ from, to, ...(await pull({ from, to })) }));
}

// ---------------------------------------------------------------------------
// Keeping itself current
// ---------------------------------------------------------------------------

/**
 * How stale the data may get before a page visit pulls again.
 *
 * Long enough that a manager flicking between pages does not hit Neon each
 * time; short enough that "who is in right now" is actually right now.
 */
const FRESH_FOR_MS = 15 * 60 * 1000;

/**
 * Memory, not the database, and that is deliberate. Render's free instance
 * sleeps when idle and wakes empty — which is exactly when a pull is wanted,
 * so losing `lastSyncAt` on a cold start is the right behaviour rather than a
 * limitation. The backfilled set being lost costs at most one small filtered
 * query per wake for someone with genuinely no punches this month.
 */
let lastSyncAt = null;
let inFlight = null;
const backfilled = new Set();

/**
 * How far back a person with no history is filled: the start of this month,
 * but never less than a fortnight, so someone enrolled on the 2nd still gets a
 * full card rather than one day.
 */
function backfillFloor(now = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const fortnight = startOfLocalDay(new Date(now.getTime() - 13 * 86400000));
  return monthStart < fortnight ? monthStart : fortnight;
}

/**
 * Codes that belong to an active employee but have no attendance since the
 * floor — enrolled after the last pull covered their days, typically.
 */
async function codesNeedingBackfill(floor) {
  const people = await prisma.employee.findMany({
    where: {
      isActive: true,
      employeeCode: { not: null },
      attendance: { none: { date: { gte: floor } } },
    },
    select: { employeeCode: true },
  });
  return people.map((p) => p.employeeCode).filter((c) => !backfilled.has(c));
}

async function autoSyncRun() {
  const today = localDateKey(new Date());
  const yesterday = localDateKey(new Date(Date.now() - 86400000));

  return locked(async () => {
    // Who needs a catch-up is decided *before* the routine pull. Afterwards,
    // someone who punched yesterday already has a row, no longer looks new,
    // and silently never gets the rest of their month.
    const floor = backfillFloor();
    const codes = await codesNeedingBackfill(floor);

    // Routine: the same two days the button pulls.
    const routine = await pull({ from: yesterday, to: today });
    let daysWritten = routine.daysWritten;

    // Catch-up: only the codes with nothing, so a new person costs one narrow
    // query instead of re-importing the whole restaurant for a month.
    if (codes.length) {
      const catchUp = await pull({ from: localDateKey(floor), to: yesterday, userIds: codes });
      daysWritten += catchUp.daysWritten;
      // Remembered even when the feed had nothing for them, or someone who
      // genuinely did not work this month would be re-queried every visit.
      for (const c of codes) backfilled.add(c);
    }

    lastSyncAt = new Date();
    return {
      status: 'synced', lastSyncAt, daysWritten, backfilled: codes.length,
      // For the scheduler's run log only — the ids nobody has been given yet
      // are the one thing a successful run needs a person to act on. Carries
      // names from every restaurant, so /refresh must not pass it through.
      processed: routine.processed,
      unmatched: routine.unmatched,
    };
  });
}

/**
 * Bring attendance up to date if it is stale. Safe to call on every page load.
 *
 * Callers never choose the range — that is what separates this from the
 * button, and why it needs no capability: all it can do is make the data
 * current. Concurrent callers share one run instead of queueing ten.
 */
export async function autoSync() {
  if (!attendanceSourceConfigured()) return { status: 'not-configured' };

  if (lastSyncAt && Date.now() - lastSyncAt.getTime() < FRESH_FOR_MS) {
    return { status: 'fresh', lastSyncAt };
  }

  if (!inFlight) {
    inFlight = autoSyncRun()
      .catch((err) => {
        // The button or the scheduler already holds the lock: their pull
        // covers the same ground, so report fresh-enough rather than failing.
        if (err.status === 409) return { status: 'busy', lastSyncAt };
        throw err;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

/** For the tests only: forget the throttle and the catch-up memory. */
export function _resetAutoSync({ keepBackfilled = false } = {}) {
  lastSyncAt = null;
  if (!keepBackfilled) backfilled.clear();
}
