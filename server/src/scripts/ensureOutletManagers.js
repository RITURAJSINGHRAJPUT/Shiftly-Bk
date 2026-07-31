/**
 * Every restaurant always has a Master of House and a Head Chef.
 *
 * Idempotent and additive: it creates only what is missing and touches nothing
 * else, so it can be run against a live database without a reseed. Useful both
 * as a backfill and as a check after adding an outlet.
 *
 * The first outlet keeps `moh@shiftly.com` / `chef@shiftly.com` — the documented
 * demo logins — and the rest get per-outlet addresses.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { OUTLET_MANAGERS, managerEmail } from './seedFromCSV.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const prisma = new PrismaClient();

async function ensureManagers({ dryRun = false } = {}) {
  const outlets = await prisma.outlet.findMany({
    where: { isActive: true },
    include: {
      employees: {
        where: { role: { in: OUTLET_MANAGERS.map((m) => m.role) }, isActive: true },
        select: { role: true, email: true, name: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (outlets.length === 0) {
    console.log('No active outlets — run `npm run seed` first.');
    return;
  }

  const password = await bcrypt.hash('admin123', 10);
  let created = 0;
  let already = 0;

  console.log(dryRun ? '🔍 Dry run — nothing will be written\n' : '👔 Ensuring outlet managers\n');

  for (const [index, outlet] of outlets.entries()) {
    const isPrimary = index === 0;
    const present = new Set(outlet.employees.map((e) => e.role));
    const missing = OUTLET_MANAGERS.filter((m) => !present.has(m.role));

    if (missing.length === 0) {
      already += OUTLET_MANAGERS.length;
      console.log(`  ✓ ${outlet.name.padEnd(16)} both roles present`);
      continue;
    }

    for (const mgr of missing) {
      const email = managerEmail(mgr.localPart, outlet.name, isPrimary);
      if (dryRun) {
        console.log(`  + ${outlet.name.padEnd(16)} would create ${mgr.title.padEnd(16)} ${email}`);
        created++;
        continue;
      }
      try {
        await prisma.employee.create({
          data: {
            name: `${mgr.title} — ${outlet.name}`,
            email,
            password,
            role: mgr.role,
            department: mgr.department,
            outletId: outlet.id,
            skills: [],
          },
        });
        console.log(`  + ${outlet.name.padEnd(16)} created ${mgr.title.padEnd(16)} ${email}`);
        created++;
      } catch (err) {
        // A duplicate email means the account exists at another outlet — report
        // it rather than swallowing it, since it leaves the rule unsatisfied.
        if (err.code === 'P2002') {
          console.error(`  ⚠️ ${outlet.name.padEnd(16)} ${email} already belongs to another employee`);
        } else {
          console.error(`  ⚠️ ${outlet.name.padEnd(16)} ${err.message}`);
        }
      }
    }
    already += OUTLET_MANAGERS.length - missing.length;
  }

  console.log(
    `\n${dryRun ? 'Would create' : 'Created'} ${created} · ${already} already in place · ` +
      `${outlets.length} outlets × ${OUTLET_MANAGERS.length} roles = ${outlets.length * OUTLET_MANAGERS.length} required`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ensureManagers({ dryRun: process.argv.includes('--dry-run') })
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error('Error:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}

export default ensureManagers;
