/**
 * Re-import a date range of attendance from Neon, so rows written under an
 * older rule are recalculated under the current one.
 *
 * Written for the switch to Neon's session rule (business_date for the day,
 * only closed in/out sessions counted as worked). The routine sync only
 * re-reads the last day or two, so every earlier row keeps its old
 * first-to-last hours until something re-imports it — this is that something.
 *
 * Importing is an upsert, so running it twice is harmless. Overtime that was
 * already approved or rejected and whose minutes change is reopened to pending
 * with an audit entry — the importer's normal rule, not something this adds.
 *
 * Usage:
 *   npm run attendance:resync -- --from 2026-09-01
 *   npm run attendance:resync -- --from 2026-09-01 --to 2026-09-21
 *   npm run attendance:resync -- --from 2026-09-01 --remote
 *
 * Default: runs here, against DATABASE_URL and ATTENDANCE_DATABASE_URL from
 * server/.env. With --remote it asks the deployed server to do it instead, via
 * POST /api/attendance/sync-job — for production, where this machine should
 * not hold the database URL. That needs SHIFTLY_API_URL and
 * ATTENDANCE_IMPORT_KEY (one of the server's ATTENDANCE_IMPORT_KEYS).
 */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

/** A week at a time: small enough that one slow Neon query cannot time out a whole month. */
const CHUNK_DAYS = 7;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.split('=')[1] : null;
}

const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

function chunks(from, to) {
  const out = [];
  for (let start = parse(from); start <= parse(to);) {
    const end = new Date(start);
    end.setDate(end.getDate() + CHUNK_DAYS - 1);
    const last = end > parse(to) ? parse(to) : end;
    out.push([key(start), key(last)]);
    start = new Date(last);
    start.setDate(start.getDate() + 1);
  }
  return out;
}

async function remoteRun(from, to) {
  const base = process.env.SHIFTLY_API_URL;
  const apiKey = process.env.ATTENDANCE_IMPORT_KEY;
  if (!base || !apiKey) throw new Error('--remote needs SHIFTLY_API_URL and ATTENDANCE_IMPORT_KEY');
  const res = await fetch(`${base.replace(/\/$/, '')}/api/attendance/sync-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({ from, to }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function main() {
  const from = arg('from');
  const to = arg('to') || key(new Date());
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    console.error('Usage: npm run attendance:resync -- --from YYYY-MM-DD [--to YYYY-MM-DD] [--remote]');
    process.exit(1);
  }
  const remote = process.argv.includes('--remote');

  // Imported lazily so --remote never needs a database connection at all.
  let run = remoteRun;
  if (!remote) {
    const { runSync } = await import('../lib/attendanceSync.js');
    run = (f, t) => runSync({ from: f, to: t });
  }

  let days = 0;
  let reopened = 0;
  for (const [f, t] of chunks(from, to)) {
    const r = await run(f, t);
    days += r.daysWritten || 0;
    reopened += r.reopened?.length || 0;
    console.log(`${f} → ${t}: ${r.processed ?? '?'} punches, ${r.daysWritten ?? 0} days written`
      + (r.reopened?.length ? `, ${r.reopened.length} overtime decisions reopened` : ''));
  }
  console.log(`\nDone: ${days} days recalculated${reopened ? `, ${reopened} overtime decisions reopened for review` : ''}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Resync failed:', err.message);
  process.exit(1);
});
