import pg from 'pg';
import { attendanceCutoffHour } from './dates.js';

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
 * system's to change, not ours. The defaults are Neon's actual punch_event
 * table, so ATTENDANCE_DATABASE_URL is the only setting a deployment needs.
 *
 * They used to be the old KGAPI names. A deployment that set the URL and not
 * the seven overrides then asked Neon for a table that does not exist, and the
 * page could only say "couldn't reach the punch log" — while the punches sat
 * right there. A default that matches no real source is a trap, not a default.
 */

const DEFAULTS = {
  table: 'punch_event',
  userId: 'external_user_id',
  timestamp: 'punched_at',
  name: 'external_name',
  source: 'source_detail',
  // Neon marks double-taps within two minutes as not counted.
  counted: 'counted',
  // punched_at is timestamptz. Without a zone it would be read as UTC and
  // every punch would land 5h30m early — verified against the KGAPI export:
  // 1,142 exact matches as IST, none as UTC.
  timezone: 'Asia/Kolkata',
};

/**
 * An override, or the default. The literal "none" switches an optional one
 * off — for a source with no counted flag, or whose times are already local.
 */
function setting(name, fallback) {
  const v = process.env[name];
  if (v === 'none') return null;
  return v || fallback;
}

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
    // Optional boolean column marking punches the source itself decided should
    // count. "none" to read every punch.
    counted: (() => {
      const col = setting('ATTENDANCE_SOURCE_COUNTED_COL', DEFAULTS.counted);
      return col ? ident(col, 'counted column') : null;
    })(),
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
export async function fetchPunches({ from, to, userIds }) {
  const url = process.env.ATTENDANCE_DATABASE_URL;
  if (!url) throw new Error('ATTENDANCE_DATABASE_URL is not set');

  const c = config();
  const zone = setting('ATTENDANCE_SOURCE_TIMEZONE', DEFAULTS.timezone);
  const cutoff = attendanceCutoffHour();

  // Positional parameters are built up rather than numbered by hand, because
  // two of them are optional and a gap in $n numbering is a Postgres error.
  const params = [from, to, cutoff];
  const param = (value) => { params.push(value); return `$${params.length}`; };

  // The punch as a local wall clock. For a timestamptz column that means
  // converting the instant to the zone the restaurants run in; a plain
  // timestamp already is one. The zone travels as a query parameter, so it
  // needs no quoting and cannot inject anything.
  const local = zone ? `(${c.timestamp} AT TIME ZONE ${param(zone)}::text)` : c.timestamp;

  // Narrowing to named people, for a catch-up that should not re-import the
  // whole restaurant. Cast to text so it works whether the source keeps ids
  // as "DP194" or as a bare integer.
  const onlyThese = Array.isArray(userIds) && userIds.length
    ? `AND ${c.userId}::text = ANY(${param(userIds.map(String))}::text[])`
    : '';

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
      // Bounded by *working* days, not calendar days. A range starting at the
      // 16th's midnight would include a 00:30 punch that belongs to the 15th's
      // evening shift, and the importer would then upsert the 15th with that
      // punch alone — overwriting the row and discarding its evening punches.
      // Offsetting both ends by the cutoff fetches exactly the punches of the
      // days asked for. Compared as local wall clock, so the boundary is the
      // restaurant's midnight rather than the database session's UTC one.
      `SELECT ${c.userId} AS userid,
              ${c.name} AS emp_name,
              to_char(${local}, 'YYYY-MM-DD HH24:MI:SS') AS edatetime,
              ${c.source} AS evtsourcedet
         FROM ${c.table}
        WHERE ${local} >= ($1::date + make_interval(hours => $3::int))
          AND ${local} <  ($2::date + INTERVAL '1 day' + make_interval(hours => $3::int))
          ${c.counted ? `AND ${c.counted}` : ''}
          ${onlyThese}
        ORDER BY ${c.timestamp}
        LIMIT ${MAX_ROWS}`,
      params
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
