/**
 * CSV Parser & Database Seeder
 * Parses the staffing CSV and seeds into PostgreSQL
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { buildTemplatesForOutlet } from './seedShiftTemplates.js';
import { parseCSVShiftPattern, applyCSVPattern } from '../engine/csvShiftParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

const prisma = new PrismaClient();

const ORGANIZATION = 'Bookends Hospitality';

const BRANDS = ['Capiche', 'Aiko'];

// Outlet configurations with Surat/Ahmedabad-area GPS coordinates.
//
// The `name` strings must stay byte-identical to the outletPatterns regexes in
// parseCSV() below — they are matched against the CSV's section headers, and a
// drift silently yields zero employees for that outlet.
const OUTLETS = [
  { name: 'Capiche PIPLOD', brand: 'Capiche', latitude: 21.1360, longitude: 72.7933, radius: 150 },
  { name: 'Capiche Vesu', brand: 'Capiche', latitude: 21.1555, longitude: 72.7710, radius: 150 },
  { name: 'Capiche Ambli', brand: 'Capiche', latitude: 23.0370, longitude: 72.5120, radius: 150 },
  { name: 'Capiche Uni', brand: 'Capiche', latitude: 21.1702, longitude: 72.7840, radius: 150 },
  { name: 'Aiko SRT', brand: 'Aiko', latitude: 21.1950, longitude: 72.8310, radius: 150 },
  { name: 'Aiko AHM', brand: 'Aiko', latitude: 23.0258, longitude: 72.5873, radius: 150 },
];

/**
 * Organization-level accounts. One each, attached to the first outlet only
 * because Employee requires an outletId — their scope is global, not that
 * outlet's (see GLOBAL_SCOPE_ROLES in lib/scope.js).
 */
const ORG_ACCOUNTS = [
  { name: 'Super Admin', email: 'superadmin@shiftly.com', role: 'SUPER_ADMIN', department: 'SERVICE' },
  { name: 'Admin User', email: 'admin@shiftly.com', role: 'ADMIN', department: 'SERVICE' },
  { name: 'HR Manager', email: 'hr@shiftly.com', role: 'HR', department: 'SERVICE' },
];

/**
 * Every restaurant always has these two. They are real working managers — the
 * head chef runs the kitchen, the master of house the floor — so unlike the org
 * accounts above they belong to their outlet and are part of its staffing pool.
 */
export const OUTLET_MANAGERS = [
  { role: 'MASTER_OF_HOUSE', department: 'SERVICE', title: 'Master of House', localPart: 'moh' },
  { role: 'HEAD_CHEF', department: 'KITCHEN', title: 'Head Chef', localPart: 'chef' },
];

/** Email slug for an outlet, matching the pattern used for staff addresses. */
export const outletSlug = (name) => name.replace(/\s+/g, '').toLowerCase().slice(0, 8);

/**
 * `moh@shiftly.com` and `chef@shiftly.com` are the documented demo logins, so
 * the first outlet keeps them; the rest get per-outlet addresses.
 */
export function managerEmail(localPart, outletName, isPrimary) {
  return isPrimary
    ? `${localPart}@shiftly.com`
    : `${localPart}@${outletSlug(outletName)}.shiftly.com`;
}

/**
 * Parse the CSV and extract employee data per outlet
 */
function parseCSV(csvPath) {
  const content = readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').map(l => l.replace(/\r/g, '').split(','));

  const outletEmployees = {};
  let currentOutlet = null;
  let currentDepartment = null;
  let currentSection = null;

  const outletPatterns = [
    { pattern: /Capiche PIPLOD/i, name: 'Capiche PIPLOD' },
    { pattern: /Capiche Vesu/i, name: 'Capiche Vesu' },
    { pattern: /Capiche Ambli/i, name: 'Capiche Ambli' },
    { pattern: /Capiche Uni/i, name: 'Capiche Uni' },
    { pattern: /Aiko SRT/i, name: 'Aiko SRT' },
    { pattern: /Aiko AHM/i, name: 'Aiko AHM' },
  ];

  const sectionPatterns = ['Pizza', 'Pasta', 'Drinks', 'Drink', 'Sushi', 'Wok', 'Side', 'Pass'];

  /**
   * Reject cells that name a station, a department or a schedule concept rather
   * than a person.
   *
   * The previous guard only tested exact single-word matches, so compound
   * headers like "Pizza section" and "Drink section" were seeded as employees —
   * 22 of them, each with a login and real shifts assigned.
   */
  const NON_PERSON = new Set([
    ...sectionPatterns.map(s => s.toLowerCase()),
    'section', 'sections', 'staffing', 'staff', 'team', 'hk', 'hk team',
    'housekeeping', 'kitchen', 'service', 'off', 'odc', 'open', 'close',
    'closing', 'opening', 'front', 'week off', 'weekoff', 'leave', 'total',
    'name', 'names', 'shift', 'shifts', 'general', 'half', 'full', 'extra',
  ]);

  function isPersonName(name) {
    const n = name.toLowerCase().trim();
    if (NON_PERSON.has(n)) return false;

    // "Pizza section", "Drink section", "HK team", "Sushi Section" …
    const words = n.split(/\s+/);
    if (words.length > 1) {
      const last = words[words.length - 1];
      if (['section', 'staffing', 'team', 'staff', 'off', 'half'].includes(last)) return false;
      // A cell whose first word is a station name is a header, not a person.
      if (sectionPatterns.some(s => s.toLowerCase() === words[0])) return false;
    }
    return true;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const firstCell = (line[0] || '').trim();
    const lineText = line.join(' ').trim();

    // Detect outlet header
    for (const vp of outletPatterns) {
      if (vp.pattern.test(lineText)) {
        currentOutlet = vp.name;
        if (!outletEmployees[currentOutlet]) {
          outletEmployees[currentOutlet] = new Map();
        }
        currentDepartment = null;
        currentSection = null;
        break;
      }
    }

    if (!currentOutlet) continue;

    // Detect department
    if (/kitchen/i.test(lineText) && /staff|monday|tuesday/i.test(lineText)) {
      currentDepartment = 'KITCHEN';
      currentSection = null;
      continue;
    }
    if (/service/i.test(lineText) && /staff|monday|tuesday/i.test(lineText)) {
      currentDepartment = 'SERVICE';
      currentSection = null;
      continue;
    }
    if (/hk|housekeeping/i.test(lineText) && /staff|team/i.test(lineText)) {
      currentDepartment = 'HOUSEKEEPING';
      currentSection = null;
      continue;
    }

    if (!currentDepartment) continue;

    // Detect section headers (for kitchen)
    if (currentDepartment === 'KITCHEN') {
      for (const sec of sectionPatterns) {
        if (firstCell.toLowerCase() === sec.toLowerCase() ||
            (firstCell.toLowerCase().includes(sec.toLowerCase()) && firstCell.length < sec.length + 10)) {
          currentSection = sec.replace(/^Drink$/, 'Drinks');
          break;
        }
      }
    }

    // Extract employee names from cells
    for (const cell of line) {
      const trimmed = (cell || '').trim();
      if (!trimmed) continue;

      // Skip header-like cells
      if (/monday|tuesday|wednesday|thursday|friday|saturday|sunday|staffing|off|odc|pass|hk team|week off/i.test(trimmed) && trimmed.length < 30) continue;
      if (/^\d+\/\d+/.test(trimmed)) continue; // date like 20/07
      if (/^\d+.*july/i.test(trimmed)) continue;

      // Extract name from patterns like "Name 12-9", "Name 12", "Name=2-11"
      const names = extractNames(trimmed);
      for (const name of names) {
        if (name.length < 2 || name.length > 30) continue;
        if (/^\d+$/.test(name)) continue;
        if (!isPersonName(name)) continue;

        const key = name.toLowerCase().trim();
        if (!outletEmployees[currentOutlet].has(key)) {
          outletEmployees[currentOutlet].set(key, {
            name: capitalizeFirst(name),
            department: currentDepartment,
            skills: new Set(),
          });
        }
        // Add section as skill
        if (currentSection) {
          outletEmployees[currentOutlet].get(key).skills.add(currentSection.toLowerCase());
        }
      }
    }
  }

  return outletEmployees;
}

function extractNames(text) {
  const names = [];
  // Clean up bullet points and special chars
  let cleaned = text.replace(/[•⁠\u200B\u2060]/g, '').trim();

  // Pattern: "Name 12-9" or "Name 12:30-9:30" or "Name=2-11"
  let match = cleaned.match(/^([a-zA-Z][a-zA-Z\s]*?)[\s:=-]+\d/i);
  if (match) {
    names.push(match[1].trim());
    return names;
  }

  // Pattern: "Name (something)" 
  match = cleaned.match(/^([a-zA-Z][a-zA-Z\s]*?)\s*\(/i);
  if (match) {
    names.push(match[1].trim());
    return names;
  }

  // Pattern: "Name - something"
  match = cleaned.match(/^([a-zA-Z][a-zA-Z\s]*?)\s*-\s/i);
  if (match && !/\d/.test(match[1])) {
    names.push(match[1].trim());
    return names;
  }

  // Simple name (no numbers, no special patterns)
  if (/^[a-zA-Z][a-zA-Z\s]*$/.test(cleaned) && cleaned.length <= 25) {
    // Could be multiple names separated by commas
    if (cleaned.includes(',')) {
      for (const n of cleaned.split(',')) {
        if (n.trim()) names.push(n.trim());
      }
    } else {
      names.push(cleaned);
    }
  }

  return names;
}

function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

async function seed() {
  console.log('🌱 Starting database seed...\n');

  // Clear existing data. No cascade deletes are configured, so this order is
  // load-bearing: children before parents, all the way up the hierarchy.
  console.log('  Clearing existing data...');
  await prisma.notification.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.leave.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.shiftTemplate.deleteMany();
  await prisma.outlet.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.organization.deleteMany();

  // Organization → Brand → Outlet
  console.log('  Creating organization...');
  const organization = await prisma.organization.create({ data: { name: ORGANIZATION } });
  console.log(`    ✅ ${organization.name}`);

  console.log('  Creating brands...');
  const brandRecords = {};
  for (const name of BRANDS) {
    const brand = await prisma.brand.create({
      data: { name, organizationId: organization.id },
    });
    brandRecords[name] = brand;
    console.log(`    ✅ ${name}`);
  }

  console.log('  Creating outlets...');
  const outletRecords = {};
  for (const o of OUTLETS) {
    const outlet = await prisma.outlet.create({
      data: {
        name: o.name,
        brandId: brandRecords[o.brand].id,
        latitude: o.latitude,
        longitude: o.longitude,
        radius: o.radius,
      },
    });
    outletRecords[o.name] = outlet;
    console.log(`    ✅ ${o.name} (${o.brand})`);
  }

  // Parse CSV
  console.log('\n  Parsing CSV...');
  const csvPath = join(__dirname, '../../../assets/Shiftly Shift Shift - Sheet1.csv');
  const outletEmployees = parseCSV(csvPath);

  // Create employees from CSV
  const hashedPassword = await bcrypt.hash('shiftly123', 10);
  let totalCreated = 0;

  for (const [outletName, employeeMap] of Object.entries(outletEmployees)) {
    const outlet = outletRecords[outletName];
    if (!outlet) continue;

    console.log(`\n  Seeding ${outletName} (${employeeMap.size} employees)...`);
    let count = 0;

    for (const [key, empData] of employeeMap) {
      try {
        const emailSlug = key.replace(/\s+/g, '.').replace(/[^a-z.]/g, '');
        const outletSlug = outletName.replace(/\s+/g, '').toLowerCase().slice(0, 8);
        const email = `${emailSlug}@${outletSlug}.shiftly.com`;

        await prisma.employee.create({
          data: {
            name: empData.name,
            email,
            password: hashedPassword,
            role: 'STAFF',
            department: empData.department,
            outletId: outlet.id,
            skills: [...empData.skills],
          },
        });
        count++;
        totalCreated++;
      } catch (err) {
        // Skip duplicates
        if (err.code !== 'P2002') {
          console.error(`    ⚠️  Error creating ${empData.name}: ${err.message}`);
        }
      }
    }
    console.log(`    ✅ Created ${count} employees`);
  }

  // Organization-level accounts — one each.
  console.log('\n  Creating organization accounts...');
  const managerPassword = await bcrypt.hash('admin123', 10);
  const orderedOutlets = Object.values(outletRecords);
  const firstOutlet = orderedOutlets[0];

  for (const acct of ORG_ACCOUNTS) {
    try {
      await prisma.employee.create({
        data: { ...acct, password: managerPassword, outletId: firstOutlet.id, skills: [] },
      });
      console.log(`    ✅ ${acct.name} (${acct.email} / admin123)`);
    } catch (err) {
      if (err.code !== 'P2002') console.error(`    ⚠️ ${err.message}`);
    }
  }

  // A Master of House and a Head Chef at every outlet — always both, at every
  // restaurant. Previously there was one of each in total, sitting on the first
  // outlet, so five of six restaurants had neither.
  console.log('\n  Creating outlet managers (2 per restaurant)...');
  for (const [index, outlet] of orderedOutlets.entries()) {
    const isPrimary = index === 0;
    for (const mgr of OUTLET_MANAGERS) {
      const email = managerEmail(mgr.localPart, outlet.name, isPrimary);
      try {
        await prisma.employee.create({
          data: {
            name: `${mgr.title} — ${outlet.name}`,
            email,
            password: managerPassword,
            role: mgr.role,
            department: mgr.department,
            outletId: outlet.id,
            skills: [],
          },
        });
        console.log(`    ✅ ${outlet.name.padEnd(16)} ${mgr.title.padEnd(16)} ${email}`);
      } catch (err) {
        if (err.code !== 'P2002') console.error(`    ⚠️ ${err.message}`);
      }
    }
  }

  // Shift templates, per outlet.
  //
  // These used to be 10 rows with no outlet, so every restaurant was planned
  // with an identical set regardless of its size or stations. buildTemplatesForOutlet
  // derives them from each outlet's actual staff mix instead; it is shared with
  // seedShiftTemplates.js so both paths stay in step.
  console.log('\n  Creating per-outlet shift templates...');
  let templateCount = 0;

  for (const outlet of Object.values(outletRecords)) {
    const staff = await prisma.employee.findMany({
      where: { outletId: outlet.id, isActive: true, role: 'STAFF' },
      select: { department: true, skills: true },
    });

    const rows = buildTemplatesForOutlet(outlet.id, staff);
    if (rows.length === 0) continue;

    await prisma.shiftTemplate.createMany({ data: rows });
    templateCount += rows.length;

    const slots = rows.reduce((sum, r) => sum + r.headcount, 0);
    console.log(`    ✅ ${outlet.name} — ${rows.length} patterns, ${slots} slots/day`);
  }
  console.log(`    ✅ ${templateCount} templates across ${Object.keys(outletRecords).length} outlets`);

  // Create shifts from CSV pattern — exact per-day, per-employee assignments
  // matching the spreadsheet rather than random sampling.
  console.log('\n  Creating shifts from CSV pattern for current week...');
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7)); // Monday
  weekStart.setHours(0, 0, 0, 0);

  const csvPatternData = parseCSVShiftPattern(csvPath);
  let shiftCount = 0;

  for (const [outletName, outlet] of Object.entries(outletRecords)) {
    const outletData = csvPatternData[outletName];
    if (!outletData || outletData.assignments.length === 0) {
      console.log(`    ⚠️  ${outletName} — no shift assignments in CSV`);
      continue;
    }

    const result = await applyCSVPattern(prisma, outlet.id, outletName, weekStart, outletData);
    shiftCount += result.created;
    console.log(`    ✅ ${outletName} — ${result.created} shifts (${result.skipped} skipped)`);
    if (result.skippedNames && result.skippedNames.length > 0) {
      console.log(`       Skipped names: ${result.skippedNames.slice(0, 10).join(', ')}`);
    }
  }
  console.log(`    ✅ Created ${shiftCount} total shifts from CSV pattern`);

  // Create sample attendance for past days
  console.log('\n  Creating sample attendance records...');
  let attendanceCount = 0;
  for (let dayOffset = 0; dayOffset < today.getDay(); dayOffset++) {
    const attDate = new Date(weekStart);
    attDate.setDate(weekStart.getDate() + dayOffset);
    attDate.setHours(0, 0, 0, 0);

    const dayShifts = await prisma.shift.findMany({ where: { date: attDate } });
    for (const shift of dayShifts) {
      const statuses = ['CHECKED_OUT', 'CHECKED_OUT', 'CHECKED_OUT', 'LATE', 'ABSENT'];
      const status = statuses[Math.floor(Math.random() * statuses.length)];

      try {
        const [sh] = shift.startTime.split(':').map(Number);
        const checkIn = new Date(attDate);
        checkIn.setHours(sh, Math.floor(Math.random() * 30), 0, 0);

        const [eh] = shift.endTime.split(':').map(Number);
        const checkOut = new Date(attDate);
        checkOut.setHours(eh, Math.floor(Math.random() * 30), 0, 0);

        await prisma.attendance.create({
          data: {
            employeeId: shift.employeeId,
            date: attDate,
            checkIn: status !== 'ABSENT' ? checkIn : null,
            checkOut: status === 'CHECKED_OUT' ? checkOut : null,
            status,
            withinRange: Math.random() > 0.1,
          },
        });
        attendanceCount++;
      } catch (err) {
        // Skip duplicates
      }
    }
  }
  console.log(`    ✅ Created ${attendanceCount} attendance records`);

  const managerCount = ORG_ACCOUNTS.length + orderedOutlets.length * OUTLET_MANAGERS.length;

  console.log(`\n🎉 Seed complete!`);
  console.log(`   Total employees: ${totalCreated + managerCount}`);
  console.log(`     staff from CSV: ${totalCreated}`);
  console.log(`     org accounts:   ${ORG_ACCOUNTS.length}`);
  console.log(`     outlet managers:${orderedOutlets.length * OUTLET_MANAGERS.length} (2 per restaurant)`);
  console.log(`   Total shifts: ${shiftCount}`);
  console.log(`   Total attendance: ${attendanceCount}`);
  console.log(`\n📧 Demo Login Credentials (all management: admin123)`);
  console.log(`   Super Admin: superadmin@shiftly.com`);
  console.log(`   Admin:       admin@shiftly.com`);
  console.log(`   HR:          hr@shiftly.com`);
  console.log(`   MoH:         moh@shiftly.com          (${orderedOutlets[0].name})`);
  console.log(`   Head Chef:   chef@shiftly.com         (${orderedOutlets[0].name})`);
  console.log(`   Other outlets: moh@<outlet>.shiftly.com · chef@<outlet>.shiftly.com`);
  console.log(`   Staff:       <name>@<outlet>.shiftly.com / shiftly123\n`);

  await prisma.$disconnect();
}

// Only run when invoked directly. Without this guard, `import`ing anything from
// this file executes the whole destructive seed as a side effect — which is
// exactly what happened when ensureOutletManagers.js imported the helpers.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed().catch(err => {
    console.error('Seed error:', err);
    prisma.$disconnect();
    process.exit(1);
  });
}
