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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

const prisma = new PrismaClient();

// Venue configurations with Surat-area GPS coordinates
const VENUES = [
  { name: 'Capiche PIPLOD', latitude: 21.1360, longitude: 72.7933, radius: 150 },
  { name: 'Capiche Vesu', latitude: 21.1555, longitude: 72.7710, radius: 150 },
  { name: 'Capiche Ambli', latitude: 23.0370, longitude: 72.5120, radius: 150 },
  { name: 'Capiche Uni', latitude: 21.1702, longitude: 72.7840, radius: 150 },
  { name: 'Aiko SRT', latitude: 21.1950, longitude: 72.8310, radius: 150 },
  { name: 'Aiko AHM', latitude: 23.0258, longitude: 72.5873, radius: 150 },
];

// Admin/management demo accounts
const DEMO_ACCOUNTS = [
  { name: 'Super Admin', email: 'superadmin@shiftly.com', role: 'SUPER_ADMIN', department: 'SERVICE' },
  { name: 'Admin User', email: 'admin@shiftly.com', role: 'ADMIN', department: 'SERVICE' },
  { name: 'HR Manager', email: 'hr@shiftly.com', role: 'HR', department: 'SERVICE' },
  { name: 'Master of House', email: 'moh@shiftly.com', role: 'MASTER_OF_HOUSE', department: 'SERVICE' },
  { name: 'Head Chef', email: 'chef@shiftly.com', role: 'HEAD_CHEF', department: 'KITCHEN' },
];

/**
 * Parse the CSV and extract employee data per venue
 */
function parseCSV(csvPath) {
  const content = readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').map(l => l.replace(/\r/g, '').split(','));

  const venueEmployees = {};
  let currentVenue = null;
  let currentDepartment = null;
  let currentSection = null;

  const venuePatterns = [
    { pattern: /Capiche PIPLOD/i, name: 'Capiche PIPLOD' },
    { pattern: /Capiche Vesu/i, name: 'Capiche Vesu' },
    { pattern: /Capiche Ambli/i, name: 'Capiche Ambli' },
    { pattern: /Capiche Uni/i, name: 'Capiche Uni' },
    { pattern: /Aiko SRT/i, name: 'Aiko SRT' },
    { pattern: /Aiko AHM/i, name: 'Aiko AHM' },
  ];

  const sectionPatterns = ['Pizza', 'Pasta', 'Drinks', 'Drink', 'Sushi', 'Wok', 'Side', 'Pass'];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const firstCell = (line[0] || '').trim();
    const lineText = line.join(' ').trim();

    // Detect venue header
    for (const vp of venuePatterns) {
      if (vp.pattern.test(lineText)) {
        currentVenue = vp.name;
        if (!venueEmployees[currentVenue]) {
          venueEmployees[currentVenue] = new Map();
        }
        currentDepartment = null;
        currentSection = null;
        break;
      }
    }

    if (!currentVenue) continue;

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
        if (/^(off|odc|pass|section|staffing|team|open|close|closing|front)$/i.test(name)) continue;

        const key = name.toLowerCase().trim();
        if (!venueEmployees[currentVenue].has(key)) {
          venueEmployees[currentVenue].set(key, {
            name: capitalizeFirst(name),
            department: currentDepartment,
            skills: new Set(),
          });
        }
        // Add section as skill
        if (currentSection) {
          venueEmployees[currentVenue].get(key).skills.add(currentSection.toLowerCase());
        }
      }
    }
  }

  return venueEmployees;
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

  // Clear existing data
  console.log('  Clearing existing data...');
  await prisma.notification.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.leave.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.shiftTemplate.deleteMany();
  await prisma.venue.deleteMany();

  // Create venues
  console.log('  Creating venues...');
  const venueRecords = {};
  for (const v of VENUES) {
    const venue = await prisma.venue.create({ data: v });
    venueRecords[v.name] = venue;
    console.log(`    ✅ ${v.name}`);
  }

  // Parse CSV
  console.log('\n  Parsing CSV...');
  const csvPath = join(__dirname, '../../../assets/Shiftly Shift Shift - Sheet1.csv');
  const venueEmployees = parseCSV(csvPath);

  // Create employees from CSV
  const hashedPassword = await bcrypt.hash('shiftly123', 10);
  let totalCreated = 0;

  for (const [venueName, employeeMap] of Object.entries(venueEmployees)) {
    const venue = venueRecords[venueName];
    if (!venue) continue;

    console.log(`\n  Seeding ${venueName} (${employeeMap.size} employees)...`);
    let count = 0;

    for (const [key, empData] of employeeMap) {
      try {
        const emailSlug = key.replace(/\s+/g, '.').replace(/[^a-z.]/g, '');
        const venueSlug = venueName.replace(/\s+/g, '').toLowerCase().slice(0, 8);
        const email = `${emailSlug}@${venueSlug}.shiftly.com`;

        await prisma.employee.create({
          data: {
            name: empData.name,
            email,
            password: hashedPassword,
            role: 'STAFF',
            department: empData.department,
            venueId: venue.id,
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

  // Create demo admin accounts (assigned to first venue)
  console.log('\n  Creating demo accounts...');
  const firstVenue = Object.values(venueRecords)[0];
  for (const demo of DEMO_ACCOUNTS) {
    try {
      await prisma.employee.create({
        data: {
          ...demo,
          password: await bcrypt.hash('admin123', 10),
          venueId: firstVenue.id,
          skills: [],
        },
      });
      console.log(`    ✅ ${demo.name} (${demo.email} / admin123)`);
    } catch (err) {
      if (err.code !== 'P2002') console.error(`    ⚠️ ${err.message}`);
    }
  }

  // Create shift templates
  console.log('\n  Creating shift templates...');
  const templates = [
    { name: 'Morning Kitchen', startTime: '11:30', endTime: '20:30', section: 'General', department: 'KITCHEN' },
    { name: 'Afternoon Kitchen', startTime: '14:00', endTime: '23:00', section: 'General', department: 'KITCHEN' },
    { name: 'Pizza Section', startTime: '12:00', endTime: '21:00', section: 'Pizza', department: 'KITCHEN' },
    { name: 'Pasta Section', startTime: '12:00', endTime: '21:00', section: 'Pasta', department: 'KITCHEN' },
    { name: 'Drinks Section', startTime: '12:00', endTime: '21:00', section: 'Drinks', department: 'KITCHEN' },
    { name: 'Morning Service', startTime: '12:00', endTime: '21:00', section: null, department: 'SERVICE' },
    { name: 'Afternoon Service', startTime: '14:00', endTime: '23:00', section: null, department: 'SERVICE' },
    { name: 'Evening Service', startTime: '16:00', endTime: '01:00', section: null, department: 'SERVICE' },
    { name: 'HK Day', startTime: '11:00', endTime: '21:00', section: null, department: 'HOUSEKEEPING' },
    { name: 'HK Evening', startTime: '14:00', endTime: '00:00', section: null, department: 'HOUSEKEEPING' },
  ];

  for (const t of templates) {
    await prisma.shiftTemplate.create({ data: t });
  }
  console.log(`    ✅ Created ${templates.length} shift templates`);

  // Create some sample shifts for the current week
  console.log('\n  Creating sample shifts for current week...');
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay() + 1); // Monday

  const allEmployees = await prisma.employee.findMany({ where: { role: 'STAFF' } });
  let shiftCount = 0;

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const shiftDate = new Date(weekStart);
    shiftDate.setDate(weekStart.getDate() + dayOffset);
    shiftDate.setHours(0, 0, 0, 0);

    // Assign ~60% of employees per day
    const dailyEmployees = allEmployees.filter(() => Math.random() > 0.4);

    for (const emp of dailyEmployees) {
      const isKitchen = emp.department === 'KITCHEN';
      const isService = emp.department === 'SERVICE';

      let startTime, endTime, section;
      if (isKitchen) {
        const sections = emp.skills.length > 0 ? emp.skills : ['general'];
        section = sections[Math.floor(Math.random() * sections.length)];
        section = section.charAt(0).toUpperCase() + section.slice(1);
        const starts = ['11:30', '12:00', '12:30', '14:00', '15:00'];
        startTime = starts[Math.floor(Math.random() * starts.length)];
        const [h] = startTime.split(':').map(Number);
        endTime = `${(h + 9) % 24}:00`;
      } else if (isService) {
        section = null;
        const starts = ['12:00', '13:00', '14:00', '15:00', '16:00'];
        startTime = starts[Math.floor(Math.random() * starts.length)];
        const [h] = startTime.split(':').map(Number);
        endTime = `${(h + 9) % 24}:00`;
      } else {
        section = null;
        const starts = ['11:00', '12:00', '14:00'];
        startTime = starts[Math.floor(Math.random() * starts.length)];
        const [h] = startTime.split(':').map(Number);
        endTime = `${(h + 10) % 24}:00`;
      }

      try {
        await prisma.shift.create({
          data: {
            date: shiftDate,
            startTime,
            endTime,
            section,
            employeeId: emp.id,
            venueId: emp.venueId,
            status: shiftDate < today ? 'COMPLETED' : 'ASSIGNED',
          },
        });
        shiftCount++;
      } catch (err) {
        // Skip errors
      }
    }
  }
  console.log(`    ✅ Created ${shiftCount} sample shifts`);

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

  console.log(`\n🎉 Seed complete!`);
  console.log(`   Total employees: ${totalCreated + DEMO_ACCOUNTS.length}`);
  console.log(`   Total shifts: ${shiftCount}`);
  console.log(`   Total attendance: ${attendanceCount}`);
  console.log(`\n📧 Demo Login Credentials:`);
  console.log(`   Super Admin: superadmin@shiftly.com / admin123`);
  console.log(`   Admin:       admin@shiftly.com / admin123`);
  console.log(`   HR:          hr@shiftly.com / admin123`);
  console.log(`   MoH:         moh@shiftly.com / admin123`);
  console.log(`   Head Chef:   chef@shiftly.com / admin123`);
  console.log(`   Staff:       <name>@<venue>.shiftly.com / shiftly123\n`);

  await prisma.$disconnect();
}

seed().catch(err => {
  console.error('Seed error:', err);
  prisma.$disconnect();
  process.exit(1);
});
