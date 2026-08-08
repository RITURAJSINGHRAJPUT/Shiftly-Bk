/**
 * Per-outlet shift templates.
 *
 * Standalone and idempotent — it clears and rebuilds ShiftTemplate only, so
 * patterns can be regenerated without touching employees, shifts or attendance.
 *
 * Patterns are derived from each outlet's *own* staff rather than a fixed global
 * list, which is what makes the plans genuinely differ per restaurant: an outlet
 * with 53 kitchen staff gets larger headcounts and more stations than one with
 * 18.
 */
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const prisma = new PrismaClient();

/** Roughly half the pool is on shift on any given day. */
const half = (n) => Math.max(1, Math.ceil(n / 2));

const SERVICE_PATTERNS = [
  { name: 'Service — Early', startTime: '12:00', endTime: '21:00' },
  { name: 'Service — Late', startTime: '14:00', endTime: '23:00' },
];

/**
 * Build the template rows for one outlet from its staff mix.
 * Exported so seedFromCSV.js can reuse exactly the same logic.
 */
export function buildTemplatesForOutlet(outletId, employees) {
  const rows = [];
  const byDept = (d) => employees.filter((e) => e.department === d);

  // ---- Kitchen: one template per station that actually exists here ----
  const kitchen = byDept('KITCHEN');
  const bySection = new Map();
  let unskilled = 0;

  for (const emp of kitchen) {
    if (emp.skills.length === 0) {
      unskilled += 1;
      continue;
    }
    for (const skill of emp.skills) {
      bySection.set(skill, (bySection.get(skill) || 0) + 1);
    }
  }

  for (const [section, count] of [...bySection.entries()].sort()) {
    const label = section.charAt(0).toUpperCase() + section.slice(1);
    rows.push({
      name: `${label} Station`,
      outletId,
      department: 'KITCHEN',
      section: label,
      startTime: '12:00',
      endTime: '21:00',
      headcount: half(count),
    });
  }

  if (unskilled > 0) {
    rows.push({
      name: 'Kitchen — General',
      outletId,
      department: 'KITCHEN',
      section: 'Kitchen',
      startTime: '11:30',
      endTime: '20:30',
      headcount: half(unskilled),
    });
  }

  // ---- Service: split the on-shift pool across an early and a late team ----
  const service = byDept('SERVICE');
  if (service.length > 0) {
    const onShift = half(service.length);
    const early = Math.ceil(onShift / 2);
    SERVICE_PATTERNS.forEach((p, i) => {
      const headcount = i === 0 ? early : Math.max(1, onShift - early);
      rows.push({ ...p, outletId, department: 'SERVICE', section: 'Service', headcount });
    });
  }

  // ---- Housekeeping ----
  const hk = byDept('HOUSEKEEPING');
  if (hk.length > 0) {
    rows.push({
      name: 'Housekeeping — Day',
      outletId,
      department: 'HOUSEKEEPING',
      section: 'Housekeeping',
      startTime: '11:00',
      endTime: '21:00',
      headcount: half(hk.length),
    });
  }

  return rows;
}

async function seedTemplates() {
  console.log('🗓  Rebuilding per-outlet shift templates...\n');

  const outlets = await prisma.outlet.findMany({
    where: { isActive: true },
    include: {
      brand: { select: { name: true } },
      employees: {
        where: { isActive: true, role: 'STAFF' },
        select: { department: true, skills: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  if (outlets.length === 0) {
    console.log('  No outlets found — run `npm run seed` first.');
    return;
  }

  // Templates only; employees, shifts and attendance are left alone.
  const cleared = await prisma.shiftTemplate.deleteMany();
  console.log(`  Cleared ${cleared.count} existing template(s)\n`);

  let total = 0;
  for (const outlet of outlets) {
    const rows = buildTemplatesForOutlet(outlet.id, outlet.employees);
    if (rows.length === 0) {
      console.log(`  ⚠️  ${outlet.name} — no active staff, no templates created`);
      continue;
    }

    await prisma.shiftTemplate.createMany({ data: rows });
    total += rows.length;

    const slots = rows.reduce((sum, r) => sum + r.headcount, 0);
    console.log(`  ✅ ${outlet.name} (${outlet.brand.name}) — ${outlet.employees.length} staff`);
    console.log(`     ${rows.length} patterns, ${slots} slots/day`);
    for (const r of rows) {
      console.log(`       ${String(r.headcount).padStart(2)}× ${r.name.padEnd(22)} ${r.startTime}-${r.endTime}`);
    }
  }

  console.log(`\n🎉 Created ${total} templates across ${outlets.length} outlets`);
  await prisma.$disconnect();
}

// Only run when invoked directly, so seedFromCSV.js can import the builder.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedTemplates().catch(async (err) => {
    console.error('Template seed error:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
}
