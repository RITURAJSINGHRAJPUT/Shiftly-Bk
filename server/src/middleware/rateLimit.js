import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * Rate limits.
 *
 * There were none, so passwords could be guessed as fast as the network allowed
 * against an endpoint whose only defence was a bcrypt round.
 *
 * The scratchpad suites log in dozens of times a run, so the strict limiter is
 * relaxed when RATE_LIMIT_DISABLED is set — off by default, and never set in
 * anything that serves real traffic.
 */
// Read per request, not once at import: this module is evaluated during the
// import graph, which may be before index.js calls dotenv.config(). Reading it
// eagerly made the switch depend on import order.
const disabled = () => process.env.RATE_LIMIT_DISABLED === 'true';

/**
 * Credentials. Counts only failures — `skipSuccessfulRequests` — so a busy shift
 * change with everyone signing in correctly never trips it, while a guessing run
 * hits the wall in twenty attempts.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  // `skip`, not `limit: 0` — the meaning of a zero limit changed between major
  // versions of this library, and "disable" is not something to leave to that.
  skip: () => disabled(),
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Wait a few minutes and try again.' },
});

/** Everything else — a backstop against a runaway client, not a security control. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  skip: () => disabled(),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down and try again shortly.' },
});

/**
 * The public integration API.
 *
 * Keyed on the API key *and* the caller's address, not either alone.
 *
 * Key alone was wrong once this became a browser API: every visitor to the
 * consumer's website sends the same key, so they would all draw down one 60/min
 * budget and a moderately busy page would rate-limit its own readers. Address
 * alone would let one consumer's traffic count against another's when both sit
 * behind the same NAT. The pair gives each visitor of each consumer their own
 * budget.
 *
 * `ipKeyGenerator` takes the address *string* — passing (req, res) returns the
 * literal "[object Object]" for every caller, which silently collapses all of
 * them into a single bucket. It masks IPv6 down to its subnet, because a v6
 * caller can otherwise rotate through a /64 for free.
 *
 * Depends on `app.set('trust proxy', …)` in index.js: behind Render's proxy
 * req.ip is the proxy without it, which would undo the whole point.
 */
export const publicApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => `${req.get('x-api-key')?.trim() || 'anon'}:${ipKeyGenerator(req.ip)}`,
  skip: () => disabled(),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down and try again shortly.' },
});
