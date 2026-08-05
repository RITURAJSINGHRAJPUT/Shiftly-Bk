/**
 * Fill one restaurant with a full crew, for testing.
 *
 *     ALLOW_DEMO_SEED=true npm --prefix server run seed:crew -- --outlet "Aiko AHM" --dry-run
 *     ALLOW_DEMO_SEED=true npm --prefix server run seed:crew -- --outlet "Aiko AHM"
 *
 * Creates a Master of House, a Head Chef, and `--per-station` staff for each of
 * the brand's kitchen stations plus service and housekeeping — the same rows
 * Shift Master draws. Every account shares one known password and skips the
 * set-password screen, so you can sign in as any of them to check scoping and
 * what each role sees.
 *
 * Why not `seed:staff`: that creates exactly one account per outlet, and derives
 * stations from *shift templates* rather than from `Brand.stations`. With no
 * templates defined it hands out empty skills, so the allocator's station
 * matching has nothing to match on — which is most of what you would want to
 * test here.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { requireDemoSeedOptIn } from './demoGate.js';
import { outletSlug } from './seedFromCSV.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const prisma = new PrismaClient();

/**
 * Long enough to pass the app's own strength rule, so somebody who later tries
 * to change it through Settings is not told their current password is invalid.
 * `shiftly123` — the old demo password — would fail it outright.
 */
const DEFAULT_PASSWORD = 'shiftly-test-crew';

/** Enough distinct names that a 40-strong crew does not read as Person 1..40. */
const NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Reyansh', 'Krishna', 'Ishaan',
  'Shaurya', 'Atharv', 'Advik', 'Rudra', 'Kabir', 'Ansh', 'Dhruv', 'Aryan',
  'Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Myra', 'Anika', 'Navya', 'Kiara',
  'Ira', 'Prisha', 'Riya', 'Aarohi', 'Sara', 'Meera', 'Nitya', 'Tara',
  'Rohan', 'Karan', 'Manav', 'Neel', 'Yash', 'Veer', 'Om', 'Jai',
  'Isha', 'Nisha', 'Pooja', 'Rhea', 'Simran', 'Tanvi', 'Zara', 'Avni',
];

const nameFor = (i) => NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : '');

export async function seedOutletCrew({ outletName, perStation = 6, dryRun = false, password } = {}) {
  const outlet = await prisma.outlet.findFirst({
    where: { name: outletName, isActive: true },
    include: { brand: { select: { name: true, stations: true } } },
  });

  if (!outlet) {
    const all = await prisma.outlet.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
    throw new Error(
      `No active outlet called "${outletName}".\nThere is: ${all.map((o) => o.name).join(', ')}`
    );
  }

  const stations = outlet.brand.stations ?? [];
  if (stations.length === 0) {
    console.log(
      `\n  ${outlet.brand.name} has no stations defined, so the kitchen crew would ` +
      'carry no skills and\n  the allocator would have nothing to match. Add them in ' +
      'Shift Master → Stations first.\n'
    );
  }

  console.log(`\n  ${outlet.name} · ${outlet.brand.name}`);
  console.log(`  stations: ${stations.length ? stations.join(', ') : '—'}\n`);

  const slug = outletSlug(outlet.name);
  const roster = [];
  let n = 0;

  // The two the outlet is expected to have. Every restaurant is flagged on the
  // Outlets page until both exist.
  roster.push({
    localPart: 'moh', name: `${nameFor(n++)} (Master of House)`,
    role: 'MASTER_OF_HOUSE', department: 'SERVICE', skills: [],
  });
  roster.push({
    localPart: 'chef', name: `${nameFor(n++)} (Head Chef)`,
    role: 'HEAD_CHEF', department: 'KITCHEN',
    // Every station: a head chef covers anywhere, which also makes them the
    // allocator's fallback when a station's own people are unavailable.
    skills: stations.map((s) => s.toLowerCase()),
  });

  // Kitchen, one group per station.
  for (const station of stations) {
    const key = station.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (let i = 1; i <= perStation; i++) {
      roster.push({
        localPart: `${key}${i}`, name: nameFor(n++),
        role: 'STAFF', department: 'KITCHEN',
        // Lowercase because scoreEmployee tests
        // `employee.skills.includes(slot.section.toLowerCase())` — a capitalised
        // value stores fine and then silently never matches.
        skills: [station.toLowerCase()],
      });
    }
  }

  // The two rows that are departments rather than stations. No skills: stations
  // are a kitchen concept, and readStations() would strip them anyway.
  for (const [dept, key] of [['SERVICE', 'service'], ['HOUSEKEEPING', 'housekeeping']]) {
    for (let i = 1; i <= perStation; i++) {
      roster.push({
        localPart: `${key}${i}`, name: nameFor(n++),
        role: 'STAFF', department: dept, skills: [],
      });
    }
  }

  const withEmails = roster.map((r) => ({ ...r, email: `${r.localPart}@${slug}.shiftly.com` }));

  const existing = new Set(
    (await prisma.employee.findMany({
      where: { email: { in: withEmails.map((r) => r.email) } },
      select: { email: true },
    })).map((e) => e.email)
  );

  const toCreate = withEmails.filter((r) => !existing.has(r.email));

  const byGroup = new Map();
  for (const r of withEmails) {
    const label = r.role === 'STAFF' ? (r.skills[0] || r.department.toLowerCase()) : r.role;
    byGroup.set(label, (byGroup.get(label) ?? 0) + 1);
  }
  for (const [label, count] of byGroup) {
    console.log(`    ${String(count).padStart(2)} × ${label}`);
  }
  console.log(`\n  ${withEmails.length} accounts · ${toCreate.length} to create · ` +
              `${existing.size} already there`);

  if (dryRun) {
    console.log('\n  Dry run — nothing written.\n');
    return null;
  }
  if (toCreate.length === 0) {
    console.log('\n  Nothing to do.\n');
    return { created: 0, skipped: existing.size };
  }

  const plain = password || process.env.SEED_PASSWORD || DEFAULT_PASSWORD;
  const hash = await bcrypt.hash(plain, 10);

  await prisma.employee.createMany({
    data: toCreate.map((r) => ({
      name: r.name,
      email: r.email,
      role: r.role,
      department: r.department,
      outletId: outlet.id,
      skills: r.skills,
      password: hash,
      // Seed data exists to be signed in as. The set-password screen is the
      // right behaviour for a real account and pure friction for forty of them.
      mustChangePassword: false,
    })),
  });

  console.log(`\n  Created ${toCreate.length}.\n`);
  console.log(`  Sign in as any of them with:  ${plain}`);
  console.log(`  e.g.  chef@${slug}.shiftly.com  ·  ${stations[0] ? stations[0].toLowerCase() + '1@' + slug + '.shiftly.com' : 'service1@' + slug + '.shiftly.com'}\n`);

  return { created: toCreate.length, skipped: existing.size };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  requireDemoSeedOptIn('npm run seed:crew');

  const arg = (flag, fallback) => {
    const i = process.argv.indexOf(flag);
    return i > -1 ? process.argv[i + 1] : fallback;
  };

  seedOutletCrew({
    outletName: arg('--outlet'),
    perStation: Number(arg('--per-station', 6)),
    dryRun: process.argv.includes('--dry-run'),
  })
    .catch((err) => { console.error('\n  ' + err.message + '\n'); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
