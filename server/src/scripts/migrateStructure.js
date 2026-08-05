/**
 * Copy the organisation structure between two databases.
 *
 * `prisma db push` creates tables, not rows, so a freshly provisioned production
 * database has the schema and nothing in it. This moves the part that was built
 * by hand and would otherwise have to be retyped: organisations, brands (with
 * their station lists) and outlets (with their geofences).
 *
 *     # the schema has to exist in the target first
 *     DATABASE_URL='<target>' npm --prefix server run db:push
 *
 *     TARGET_DATABASE_URL='<target>' npm --prefix server run migrate:structure -- --dry-run
 *     TARGET_DATABASE_URL='<target>' npm --prefix server run migrate:structure
 *
 * Source defaults to `DATABASE_URL` from server/.env; override with
 * SOURCE_DATABASE_URL. Both come from the environment rather than arguments so a
 * connection string never lands in shell history or a transcript.
 *
 * **People are deliberately not copied.** Employees carry password hashes and, in
 * a database that has been developed against, test accounts — neither belongs in
 * production. Shifts, attendance, leave and notifications hang off employees and
 * follow the same rule. Create the first account with `reset:superadmin` and
 * enrol the rest through the app.
 */
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

/** Host only — enough to tell two databases apart, without the password. */
function describe(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return '<unparseable url>';
  }
}

export async function migrateStructure({ dryRun = false, sourceUrl, targetUrl } = {}) {
  if (!targetUrl) {
    throw new Error(
      'TARGET_DATABASE_URL is not set. Point it at the database to copy *into* —\n' +
      "  TARGET_DATABASE_URL='postgresql://…' npm --prefix server run migrate:structure"
    );
  }
  if (!sourceUrl) throw new Error('No source database. Set DATABASE_URL or SOURCE_DATABASE_URL.');
  if (sourceUrl === targetUrl) {
    throw new Error('Source and target are the same database. Nothing to do, and nothing safe to do.');
  }

  const source = new PrismaClient({ datasourceUrl: sourceUrl });
  const target = new PrismaClient({ datasourceUrl: targetUrl });

  try {
    console.log(`\n  from  ${describe(sourceUrl)}`);
    console.log(`  to    ${describe(targetUrl)}${dryRun ? '   (dry run)' : ''}\n`);

    const organizations = await source.organization.findMany({ orderBy: { name: 'asc' } });
    const brands = await source.brand.findMany({ orderBy: { name: 'asc' } });
    const outlets = await source.outlet.findMany({ orderBy: { name: 'asc' } });

    console.log(`  ${organizations.length} organisation${organizations.length === 1 ? '' : 's'}`);
    for (const o of organizations) console.log(`      ${o.name}`);
    console.log(`  ${brands.length} brands`);
    for (const b of brands) {
      console.log(`      ${b.name.padEnd(12)} stations: ${b.stations.length ? b.stations.join(', ') : '—'}`);
    }
    console.log(`  ${outlets.length} outlets`);
    for (const o of outlets) console.log(`      ${o.name}`);

    const people = await source.employee.count();
    console.log(`\n  not copied: ${people} employees, and the shifts, attendance, leave and`);
    console.log('              notifications that hang off them\n');

    if (dryRun) {
      console.log('  Dry run — nothing written.\n');
      return null;
    }

    // Foreign-key order, and ids preserved so re-running updates the same rows
    // rather than creating a second copy under new ids.
    let written = 0;
    for (const o of organizations) {
      await target.organization.upsert({ where: { id: o.id }, update: o, create: o });
      written++;
    }
    for (const b of brands) {
      await target.brand.upsert({ where: { id: b.id }, update: b, create: b });
      written++;
    }
    for (const o of outlets) {
      await target.outlet.upsert({ where: { id: o.id }, update: o, create: o });
      written++;
    }

    const after = {
      organizations: await target.organization.count(),
      brands: await target.brand.count(),
      outlets: await target.outlet.count(),
      employees: await target.employee.count(),
    };

    console.log(`  wrote ${written} rows.\n`);
    console.log('  target now holds:');
    console.log(`      ${after.organizations} organisations · ${after.brands} brands · ` +
                `${after.outlets} outlets · ${after.employees} employees\n`);
    if (after.employees === 0) {
      console.log('  Next: create the first account.');
      console.log("      DATABASE_URL='<target>' npm --prefix server run reset:superadmin\n");
    }
    return after;
  } finally {
    await source.$disconnect();
    await target.$disconnect();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrateStructure({
    dryRun: process.argv.includes('--dry-run'),
    sourceUrl: process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL,
    targetUrl: process.env.TARGET_DATABASE_URL,
  }).catch((err) => {
    console.error('\n  ' + err.message + '\n');
    process.exitCode = 1;
  });
}
