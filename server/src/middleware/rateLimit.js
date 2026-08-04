import rateLimit from 'express-rate-limit';

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
