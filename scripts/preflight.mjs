/**
 * Pre-flight checks for `npm run dev`.
 *
 * Runs as `predev`. The point is to fail on the things that are definitely
 * fatal, with a message that says what to do, instead of letting the user hit a
 * Prisma stack trace or a blank page.
 *
 * Fatal: missing dependencies, missing server/.env.
 * Warning only: Postgres not reachable, ports in use — both are things the user
 * may be about to fix, so they are surfaced rather than blocking.
 *
 * No dependencies, so this runs before anything is installed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const fatal = [];
const warn = [];

// --- dependencies -----------------------------------------------------------
for (const pkg of ['server', 'client']) {
  if (!existsSync(join(root, pkg, 'node_modules'))) {
    fatal.push(`${pkg}/node_modules is missing.\n    Run: ${c.bold('npm install')}`);
  }
}

// --- server/.env ------------------------------------------------------------
const envPath = join(root, 'server', '.env');
if (!existsSync(envPath)) {
  fatal.push(
    `server/.env is missing (it is gitignored, so a fresh clone has none).\n` +
      `    Create it with:\n\n` +
      c.dim(`      cat > server/.env <<'EOF'\n`) +
      c.dim(`      DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5432/shiftly?schema=public"\n`) +
      c.dim(`      JWT_SECRET="change-me-to-something-random"\n`) +
      c.dim(`      PORT=3001\n`) +
      c.dim(`      EOF`)
  );
} else {
  const env = readFileSync(envPath, 'utf8');
  for (const key of ['DATABASE_URL', 'JWT_SECRET']) {
    if (!new RegExp(`^\\s*${key}\\s*=\\s*\\S`, 'm').test(env)) {
      fatal.push(`server/.env is missing ${key}.`);
    }
  }
}

// --- prisma client generated ------------------------------------------------
if (
  existsSync(join(root, 'server', 'node_modules')) &&
  !existsSync(join(root, 'server', 'node_modules', '.prisma', 'client'))
) {
  fatal.push(
    `The Prisma client has not been generated.\n    Run: ${c.bold('npm run db:generate')}`
  );
}

// --- port / postgres reachability (warnings) --------------------------------
const probe = (port, host = '127.0.0.1', timeout = 700) =>
  new Promise((resolve) => {
    const s = createConnection({ port, host });
    const done = (open) => {
      s.destroy();
      resolve(open);
    };
    s.setTimeout(timeout);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });

const [pgUp, apiBusy, webBusy] = await Promise.all([probe(5432), probe(3001), probe(5173)]);

if (!pgUp) {
  warn.push(
    `PostgreSQL is not answering on 127.0.0.1:5432 — the API will fail to query.\n` +
      `    Start it, e.g.: ${c.bold('brew services start postgresql@16')}`
  );
}
if (apiBusy) {
  warn.push(
    `Port 3001 is already in use. A stale API will keep serving old code.\n` +
      `    Free it with: ${c.bold('npm run ports:free')}`
  );
}
if (webBusy) {
  warn.push(`Port 5173 is already in use — Vite will pick the next free port.`);
}

// --- report -----------------------------------------------------------------
if (warn.length) {
  console.log('');
  for (const w of warn) console.log(`${c.yellow('!')} ${w}`);
}

if (fatal.length) {
  console.log('');
  console.log(c.red(c.bold('Cannot start — fix the following:')));
  for (const f of fatal) console.log(`\n${c.red('✗')} ${f}`);
  console.log('');
  console.log(c.dim('  Full setup instructions: RUNNING.md'));
  console.log('');
  process.exit(1);
}

if (!warn.length) {
  console.log(c.green('✓') + ' preflight ok — starting api on :3001 and web on :5173\n');
} else {
  console.log('');
}
