/**
 * Wipe every account and leave one super admin.
 *
 * The organisation stays exactly as it is — organisations, brands, outlets and
 * each brand's station list are untouched. What goes is the people: the demo
 * accounts and everything hanging off them (shifts, attendance, leave,
 * notifications), replaced by a single SUPER_ADMIN who enrols the real staff.
 *
 * The password is generated here and printed once. It is stored as a bcrypt
 * hash, so this run is the only chance to read it — and the account is flagged
 * `mustChangePassword`, so it must be replaced at first sign-in anyway.
 *
 *   node src/scripts/resetToSuperAdmin.js [--dry-run] [--email you@example.com]
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { generateTemporaryPassword } from '../lib/passwords.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const prisma = new PrismaClient();

const DEFAULT_EMAIL = 'superadmin@shiftly.com';

export async function resetToSuperAdmin({ dryRun = false, email = DEFAULT_EMAIL } = {}) {
  const [employees, shifts, attendance, leaves, notifications] = await Promise.all([
    prisma.employee.count(),
    prisma.shift.count(),
    prisma.attendance.count(),
    prisma.leave.count(),
    prisma.notification.count(),
  ]);

  // Kept, and reported, so it is obvious this is not a full database wipe.
  const [orgs, brands, outlets, templates] = await Promise.all([
    prisma.organization.count(),
    prisma.brand.count(),
    prisma.outlet.count(),
    prisma.shiftTemplate.count(),
  ]);

  console.log('\nWill delete');
  console.log(`  ${employees} employees · ${shifts} shifts · ${attendance} attendance ` +
              `· ${leaves} leave · ${notifications} notifications`);
  console.log('Will keep');
  console.log(`  ${orgs} organisations · ${brands} brands · ${outlets} outlets ` +
              `· ${templates} shift patterns\n`);

  if (dryRun) {
    console.log(`Dry run. Would create SUPER_ADMIN ${email}, belonging to no outlet.\n`);
    return null;
  }

  const password = generateTemporaryPassword();

  // One transaction: a half-applied run would leave the app with no way in.
  // Deletion order matters — nothing cascades in this schema.
  await prisma.$transaction(async (tx) => {
    await tx.notification.deleteMany({});
    await tx.attendance.deleteMany({});
    await tx.leave.deleteMany({});
    await tx.shift.deleteMany({});
    await tx.employee.deleteMany({});

    await tx.employee.create({
      data: {
        name: process.env.SUPERADMIN_NAME || 'Utsav Singh',
        email,
        role: 'SUPER_ADMIN',
        // No outlet and no department: this account is organisation-wide, and
        // pinning it to a restaurant is what put "Aiko AHM · SERVICE" on its
        // profile and counted it against that restaurant's headcount.
        outletId: null,
        department: null,
        password: await bcrypt.hash(password, 10),
        mustChangePassword: true,
        skills: [],
      },
    });
  });

  console.log('Done. One account remains:\n');
  console.log(`  email     ${email}`);
  console.log(`  password  ${password}`);
  console.log('\nShown once — it is stored only as a hash. You will be asked to');
  console.log('choose your own password the first time you sign in.\n');
  console.log('Every outlet now reports a missing Master of House and Head Chef.');
  console.log('That is expected: enrol them from the Employees page.\n');

  return { email };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const emailFlag = process.argv.indexOf('--email');
  resetToSuperAdmin({
    dryRun: process.argv.includes('--dry-run'),
    email: emailFlag > -1 ? process.argv[emailFlag + 1] : DEFAULT_EMAIL,
  })
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
