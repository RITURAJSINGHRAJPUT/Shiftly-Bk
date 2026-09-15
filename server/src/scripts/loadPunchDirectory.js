/**
 * Load the punch directory from a KGAPI payload.
 *
 * `PunchIdentity` is the list of people the biometric feed knows about. The
 * enrolment form reads it through GET /api/employees/lookup: type a code, and
 * the name the punch log has for that code appears. That whole path already
 * exists — it just returns nothing while the table is empty, which is what this
 * fills.
 *
 * Identities only. The same payload also carries the punches themselves, and
 * those belong to POST /api/attendance/import, which aggregates them into
 * Attendance rows and writes an audit entry. Creating attendance from a seed
 * script would produce days nobody asked for and no record of where they came
 * from.
 *
 * Usage:
 *   npm --prefix server run directory:load -- --dry-run
 *   npm --prefix server run directory:load
 *   npm --prefix server run directory:load -- path/to/other.json
 *
 * Idempotent: re-running updates name, lastSeen and punchCount in place.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import prisma from '../db.js';
// The one definition, shared with the importer. KGAPI sends
// "2026-09-10 08:54:06.0", which `new Date(...)` reads as UTC in some runtimes
// and local in others; parsing it by hand is the only way both agree.
import { parsePunchTimestamp } from '../engine/attendanceImport.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = join(__dirname, '../../../assets/emplist.txt');

/**
 * One entry per distinct userid.
 *
 * Mirrors the aggregation in importPunches() so the two cannot disagree about
 * what an identity is: first name seen wins, punches are counted, and lastSeen
 * is the newest timestamp in the payload.
 */
function collectIdentities(punches) {
  const byUserId = new Map();
  let skipped = 0;

  for (const punch of punches) {
    // employeeCode is a string column and the feed sometimes sends numbers;
    // coerced here for the same reason attendanceSource.js does it.
    const userid = punch.userid == null ? null : String(punch.userid).trim();
    if (!userid || !punch.edatetime) { skipped++; continue; }

    const time = parsePunchTimestamp(punch.edatetime);
    if (Number.isNaN(time.getTime())) { skipped++; continue; }

    const entry = byUserId.get(userid) || { userid, name: null, punchCount: 0, lastSeen: time };
    if (punch.emp_name && !entry.name) entry.name = String(punch.emp_name).trim() || null;
    entry.punchCount += 1;
    if (time > entry.lastSeen) entry.lastSeen = time;
    byUserId.set(userid, entry);
  }

  return { identities: [...byUserId.values()], skipped };
}

function readPayload(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  // KGAPI wraps the array; accept a bare array too, so a hand-trimmed file works.
  const punches = Array.isArray(raw) ? raw : raw.GetAttandance;
  if (!Array.isArray(punches)) {
    throw new Error('Expected a JSON array, or an object with a GetAttandance array.');
  }
  return punches;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const file = resolve(args.find((a) => !a.startsWith('--')) || DEFAULT_FILE);

  const punches = readPayload(file);
  const { identities, skipped } = collectIdentities(punches);
  identities.sort((a, b) => a.userid.localeCompare(b.userid));

  console.log(`\n  ${file}`);
  console.log(`  ${punches.length} punches → ${identities.length} distinct people` +
    (skipped ? ` (${skipped} unusable rows skipped)` : ''));

  if (identities.length === 0) {
    console.log('  Nothing to load.\n');
    return;
  }

  const sample = identities.slice(0, 5);
  console.log('\n  sample:');
  for (const i of sample) {
    console.log(`    ${i.userid.padEnd(8)} ${(i.name || '(no name)').padEnd(32)} ` +
      `${i.punchCount} punches, last ${i.lastSeen.toISOString().slice(0, 10)}`);
  }

  if (dryRun) {
    console.log('\n  --dry-run: nothing written.\n');
    return;
  }

  // Sequential rather than a transaction: this is a catch-up load of reference
  // data, and one malformed row should not discard the other 303.
  let created = 0;
  let updated = 0;
  for (const { userid, ...identity } of identities) {
    const existing = await prisma.punchIdentity.findUnique({ where: { userid } });
    await prisma.punchIdentity.upsert({
      where: { userid },
      update: identity,
      create: { userid, ...identity },
    });
    existing ? updated++ : created++;
  }

  const total = await prisma.punchIdentity.count();
  console.log(`\n  ${created} created, ${updated} updated. Directory now holds ${total}.\n`);
}

main()
  .catch((err) => {
    console.error(`\n  Failed: ${err.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
