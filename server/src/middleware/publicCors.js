import cors from 'cors';

/**
 * CORS for the public integration API, and nothing else.
 *
 * The app itself is same-origin — Express serves the built client from this
 * same process — so the global cors() in index.js stays unset in production and
 * no CORS headers are emitted anywhere. That is correct for the app and fatal
 * for this endpoint, whose whole purpose is to be fetched by JavaScript running
 * on somebody else's website.
 *
 * Scoped to the public router rather than mounted app-wide: opening CORS across
 * /api would expose every JWT-guarded endpoint to cross-origin reads too.
 */

/**
 * Origins allowed to read this API from a browser.
 *
 * Read per request rather than at import, matching rateLimit.js — this module
 * is evaluated while index.js is still resolving its import graph, which is
 * before dotenv.config() runs.
 */
function allowedOrigins() {
  return (process.env.PUBLIC_API_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export const publicCors = cors({
  /**
   * An allowlist, compared exactly.
   *
   * Worth being clear about what this does and does not do: it is enforced by
   * the browser, not by us. It stops another *website* embedding this data in a
   * page. It stops nothing at all from curl or a server, which never send an
   * Origin and never read the reply header — those callers are held off by the
   * API key and the rate limit instead.
   *
   * `false` rather than an error: cors() turns a thrown error into a 500, and a
   * disallowed origin is not a server fault. Omitting the header is the correct
   * answer, and the browser turns that into the CORS failure the caller should
   * see.
   */
  origin(origin, callback) {
    // No Origin header at all — curl, a server, a same-origin request. Allowed
    // through with no CORS headers, which is what those callers expect.
    if (!origin) return callback(null, false);

    const allowed = allowedOrigins();
    callback(null, allowed.includes(origin.replace(/\/$/, '')));
  },

  methods: ['GET', 'OPTIONS'],

  // The browser will not send a custom header unless it is named here, and
  // X-API-Key is what makes the preflight happen in the first place.
  allowedHeaders: ['X-API-Key'],

  // Cross-origin JavaScript cannot read a response header unless it is exposed,
  // so without this a consumer cannot see its own remaining budget.
  exposedHeaders: ['RateLimit', 'RateLimit-Policy', 'Retry-After'],

  // Deliberately absent: `credentials: true`. There are no cookies or sessions
  // on this API — the key is the whole credential — and enabling it would rule
  // out ever widening the allowlist to '*' while inviting exactly that mistake.

  // Cache the preflight for a day. Without it a browser preflights every single
  // request, doubling the traffic reaching a free-tier service.
  maxAge: 86400,

  optionsSuccessStatus: 204,
});

export default publicCors;
