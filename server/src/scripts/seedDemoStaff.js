/**
 * A minimal demo staff set — one account at every outlet.
 *
 * The full CSV import creates 191 staff; this creates just enough to sign in as
 * a staff member and exercise the roster, check-in and leave flows without
 * repopulating the whole directory.
 *
 * Idempotent and additive: existing addresses are skipped, so it is safe to
 * re-run and safe against live data.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { outletSlug } from './seedFromCSV.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const prisma = new PrismaClient();

/**
 * One staff account per outlet — the minimum needed to sign in as a staff
 * member and exercise the roster, check-in and leave flows.
 *
 * Kitchen, because that is where stations and skill matching actually apply;
 * a service or housekeeping account would carry no skills to match on.
 *
 * Plain first name, deliberately without the outlet appended — the manager
 * accounts use `Title — Outlet`, which then had to be stripped with a regex to
 * render cleanly on the Outlets page.
 */
const ROSTER = [
  { localPart: 'kitchen1', name: 'Arjun', department: 'KITCHEN' },
];

/** How many KITCHEN entries ROSTER holds — drives the station round-robin. */
const KITCHEN_COUNT = ROSTER.filter((r) => r.department === 'KITCHEN').length;

async function seedDemoStaff({ dryRun = false } = {}) {
  const outlets = await prisma.outlet.findMany({
    where: { isActive: true },
    include: {
      brand: { select: { name: true } },
      // Stations this restaurant actually runs, so the demo staff's skills line
      // up with its patterns and the allocator's +30 skill term does real work.
      shiftTemplates: {
        where: { isActive: true, department: 'KITCHEN', section: { not: null } },
        select: { section: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (outlets.length === 0) {
    console.log('No active outlets — run `npm run seed` first.');
    return;
  }

  const password = await bcrypt.hash('shiftly123', 10);
  let created = 0;
  let skipped = 0;

  console.log(dryRun ? '🔍 Dry run — nothing will be written\n' : '👥 Seeding demo staff\n');

  for (const outlet of outlets) {
    const slug = outletSlug(outlet.name);
    const stations = [...new Set(outlet.shiftTemplates.map((t) => t.section.toLowerCase()))].sort();

    console.log(`  ${outlet.name} (${outlet.brand.name})`);
    if (stations.length === 0) {
      console.log('    · no kitchen stations defined — kitchen staff get no skills');
    }

    let kitchenIndex = 0;

    for (const person of ROSTER) {
      const email = `${person.localPart}@${slug}.shiftly.com`;

      const existing = await prisma.employee.findUnique({ where: { email } });
      if (existing) {
        skipped++;
        console.log(`    · ${email.padEnd(34)} already exists`);
        continue;
      }

      // Deal the stations round-robin across however many kitchen staff there
      // are, so together they cover the whole menu. Keyed off KITCHEN_COUNT
      // rather than a hardcoded 2: with a single kitchen account the modulo
      // collapses to "every station", which is what makes skill matching work
      // for that outlet at all.
      let skills = [];
      if (person.department === 'KITCHEN' && stations.length > 0) {
        skills = stations.filter((_, i) => i % KITCHEN_COUNT === kitchenIndex);
        if (skills.length === 0) skills = [stations[0]];
        kitchenIndex++;
      }

      if (dryRun) {
        created++;
        console.log(`    + ${email.padEnd(34)} ${person.department.padEnd(13)} [${skills.join(', ')}]`);
        continue;
      }

      try {
        await prisma.employee.create({
          data: {
            name: person.name,
            email,
            password,
            role: 'STAFF',
            department: person.department,
            outletId: outlet.id,
            skills,
          },
        });
        created++;
        console.log(`    + ${email.padEnd(34)} ${person.department.padEnd(13)} [${skills.join(', ')}]`);
      } catch (err) {
        console.error(`    ⚠️ ${email}: ${err.message}`);
      }
    }
  }

  const total = outlets.length * ROSTER.length;
  console.log(
    `\n${dryRun ? 'Would create' : 'Created'} ${created} · ${skipped} already present · ` +
      `${outlets.length} outlets × ${ROSTER.length} = ${total} expected`
  );
  console.log('\nSign in with any of them using password: shiftly123');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedDemoStaff({ dryRun: process.argv.includes('--dry-run') })
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error('Error:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}

export default seedDemoStaff;
