/**
 * Refuses to run a demo seeder unless it is explicitly asked for.
 *
 * These scripts create accounts with passwords written down in this repository.
 * That was fine when Shiftly was a demo; now that real accounts exist, a stray
 * `npm run seed` or a deploy hook that runs it would quietly put a known
 * password back into a live database — and `seed` is destructive besides.
 *
 * Set ALLOW_DEMO_SEED=true for the one command you actually mean to run:
 *
 *   ALLOW_DEMO_SEED=true npm run seed:staff
 */
export function requireDemoSeedOptIn(scriptName) {
  if (process.env.ALLOW_DEMO_SEED === 'true') return;

  console.error(
    `\nRefusing to run ${scriptName}.\n\n` +
    `It creates accounts with passwords published in this repository, and would\n` +
    `overwrite real ones. If that is genuinely what you want:\n\n` +
    `  ALLOW_DEMO_SEED=true npm run <script>\n`
  );
  process.exit(1);
}
