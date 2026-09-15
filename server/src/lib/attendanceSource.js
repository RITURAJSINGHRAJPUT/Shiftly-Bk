import pg from 'pg';

/**
 * Reads the raw punch log out of the attendance database.
 *
 * A separate Postgres (Neon) holding whatever the biometric readers and the
 * mobile app record. It is a foreign schema — not managed by this repo's
 * Prisma — so this talks to it with the `pg` driver directly rather than a
 * second PrismaClient, and returns rows in exactly the shape importPunches()
 * already takes. Nothing downstream needs to know where the punches came from.
 *
 * The table and column names are configurable because the schema is the other
 * system's to change, not ours. Defaults match the KGAPI feed this replaces.
 */

const DEFAULTS = {
  table: 'attendance_punches',
  userId: 'userid',
  timestamp: 'edatetime',
  name: 'emp_name',
  source: 'evtsourcedet',
};

/**
 * Identifiers cannot be passed as query parameters, so these end up
 * interpolated into SQL. Anything from the environment gets checked against a
 * plain identifier shape first and refuses to start otherwise — the same
 * "fail at boot rather than at the first request" stance auth.js takes with
 * JWT_SECRET.
 */
function ident(value, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`ATTENDANCE_SOURCE ${label} must be a plain SQL identifier, got "${value}"`);
  }
  return `"${value}"`;
}

function config() {
  const e = process.env;
  return {
    table: ident(e.ATTENDANCE_SOURCE_TABLE || DEFAULTS.table, 'table'),
    userId: ident(e.ATTENDANCE_SOURCE_USERID_COL || DEFAULTS.userId, 'userid column'),
    timestamp: ident(e.ATTENDANCE_SOURCE_TIME_COL || DEFAULTS.timestamp, 'timestamp column'),
    name: ident(e.ATTENDANCE_SOURCE_NAME_COL || DEFAULTS.name, 'name column'),
    source: ident(e.ATTENDANCE_SOURCE_DEVICE_COL || DEFAULTS.source, 'device column'),
  };
}

/** Refuses a run rather than half-completing one. */
export function attendanceSourceConfigured() {
  return Boolean(process.env.ATTENDANCE_DATABASE_URL);
}

/** No single pull should ever be this large; a mistyped range hits this, not memory. */
const MAX_ROWS = 50000;

/**
 * Punches between two YYYY-MM-DD dates, inclusive of both days.
 *
 * `to_char` rather than letting the driver hand back a Date: if the column is
 * `timestamp` the driver returns a JS Date whose string form starts with the
 * weekday, which the punch parser would read as a year and turn into an
 * invalid date; if it is `timestamptz` the driver silently converts it to the
 * server process's zone, which is a different wall clock from the one the
 * punch was recorded in. Formatting in Postgres settles both questions here,
 * where they are visible, instead of somewhere downstream.
 */
export async function fetchPunches({ from, to }) {
  const url = process.env.ATTENDANCE_DATABASE_URL;
  if (!url) throw new Error('ATTENDANCE_DATABASE_URL is not set');

  const c = config();
  const zone = process.env.ATTENDANCE_SOURCE_TIMEZONE;
  // AT TIME ZONE only applies to timestamptz columns; for a plain timestamp the
  // stored wall clock is already the answer, so the cast is left off.
  const timeExpr = zone
    ? `to_char(${c.timestamp} AT TIME ZONE '${zone.replace(/'/g, "''")}', 'YYYY-MM-DD HH24:MI:SS')`
    : `to_char(${c.timestamp}, 'YYYY-MM-DD HH24:MI:SS')`;

  const client = new pg.Client({
    connectionString: url,
    // Neon suspends an idle compute; the first query of the day pays a cold
    // start of several seconds. A short timeout here fails every morning run.
    connectionTimeoutMillis: 15000,
    query_timeout: 60000,
    statement_timeout: 60000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT ${c.userId} AS userid,
              ${c.name} AS emp_name,
              ${timeExpr} AS edatetime,
              ${c.source} AS evtsourcedet
         FROM ${c.table}
        WHERE ${c.timestamp} >= $1::date
          AND ${c.timestamp} < ($2::date + INTERVAL '1 day')
        ORDER BY ${c.timestamp}
        LIMIT ${MAX_ROWS}`,
      [from, to]
    );

    // employeeCode is a string column; an integer userid would make Prisma
    // reject the whole lookup, so the coercion happens at the boundary.
    return rows.map((r) => ({
      userid: r.userid == null ? null : String(r.userid),
      emp_name: r.emp_name ?? null,
      edatetime: r.edatetime,
      evtsourcedet: r.evtsourcedet ?? null,
    }));
  } finally {
    // A client per run, never a pool: both ends of this connection go away on
    // their own — Render's instance sleeps, Neon's compute suspends — and a
    // pooled connection would come back dead with nothing to notice.
    await client.end().catch(() => {});
  }
}
