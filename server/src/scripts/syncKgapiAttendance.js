/**
 * Pull attendance punches from KGAPI and push them into Shiftly.
 *
 * KGAPI (the biometric/mobile-app punch log) lives on a private network
 * address — reachable only from a machine on that same LAN, not from
 * Shiftly's own server (Render has no route into it). So this runs the other
 * way around from a typical sync: it's meant to execute on a machine inside
 * that network (via Windows Task Scheduler / cron, once a day), which pulls
 * from KGAPI and pushes the raw punches to Shiftly's own
 * POST /api/attendance/import — rather than Shiftly pulling from KGAPI.
 *
 * Deliberately has no Prisma/database access of its own: it only speaks HTTP
 * to two endpoints, so the machine running it never needs the production
 * DATABASE_URL, only a scoped API key. All the matching/aggregation logic
 * lives server-side in engine/attendanceImport.js — this script is a dumb
 * fetch-and-forward.
 *
 * Usage:
 *   node src/scripts/syncKgapiAttendance.js
 *   node src/scripts/syncKgapiAttendance.js --from=01-Jul-2026 --to=05-Jul-2026
 *
 * With no --from/--to, defaults to yesterday (the usual case for a nightly
 * scheduled run — today's punches aren't finished yet).
 *
 * Config (env vars, or server/.env when run from this repo):
 *   KGAPI_BASE_URL          e.g. http://192.168.100.22:8080/KG_WEB_APP0/KGAPI/powerbi/GetAttandanceBookend
 *   SHIFTLY_API_URL         e.g. https://shiftly-bk.onrender.com
 *   ATTENDANCE_IMPORT_KEY   one value from ATTENDANCE_IMPORT_KEYS on the server
 */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** KGAPI's expected format, e.g. "01-Jul-2026". */
function formatKgapiDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mmm = MONTHS[date.getMonth()];
  return `${dd}-${mmm}-${date.getFullYear()}`;
}

function argValue(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

async function main() {
  const kgapiBase = process.env.KGAPI_BASE_URL;
  const shiftlyUrl = process.env.SHIFTLY_API_URL;
  const importKey = process.env.ATTENDANCE_IMPORT_KEY;

  if (!kgapiBase || !shiftlyUrl || !importKey) {
    console.error(
      'Missing config — set KGAPI_BASE_URL, SHIFTLY_API_URL and ATTENDANCE_IMPORT_KEY ' +
      '(in the environment, or server/.env when run from this repo).'
    );
    process.exit(1);
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const fromDate = argValue('from') || formatKgapiDate(yesterday);
  const toDate = argValue('to') || formatKgapiDate(yesterday);

  const kgapiUrl = `${kgapiBase}?p_fromDate=${encodeURIComponent(fromDate)}&p_toDate=${encodeURIComponent(toDate)}`;
  console.log(`Fetching punches ${fromDate} to ${toDate} from KGAPI...`);

  const kgapiRes = await fetch(kgapiUrl);
  if (!kgapiRes.ok) {
    console.error(`KGAPI request failed: HTTP ${kgapiRes.status}`);
    process.exit(1);
  }
  const kgapiBody = await kgapiRes.json();
  const punches = kgapiBody.GetAttandance || [];
  console.log(`Got ${punches.length} punch events.`);

  if (punches.length === 0) {
    console.log('Nothing to import.');
    return;
  }

  const importRes = await fetch(`${shiftlyUrl}/api/attendance/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': importKey,
    },
    body: JSON.stringify(punches),
  });

  const summary = await importRes.json();
  if (!importRes.ok) {
    console.error(`Import failed: HTTP ${importRes.status}`, summary);
    process.exit(1);
  }

  console.log(`Imported: ${summary.daysWritten} employee-days written from ${summary.processed} punches.`);
  if (summary.unmatched?.length) {
    console.warn(
      `${summary.unmatched.length} userid(s) have no matching employeeCode in Shiftly — ` +
      'set it on their profile to pick them up next run:'
    );
    for (const u of summary.unmatched) {
      console.warn(`  ${u.userid}  ${u.name || '(no name in feed)'}  ${u.punchCount} punches`);
    }
  }
}

main().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
