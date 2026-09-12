import crypto from 'crypto';

/**
 * Shared-secret gate for machine-to-machine endpoints with no logged-in user.
 *
 * Everything else in this app is behind a JWT that pins the caller to a role
 * and an outlet. Routes with no user at all need their own key instead — a
 * value handed to an integrator, not minted by logging in.
 *
 * Keys live in an env var, comma separated (default PUBLIC_API_KEYS, for the
 * original caller). A second caller (e.g. the attendance import) passes its
 * own env var name so a leaked read-only key can't also be used to write
 * data — each integration gets its own credential, not a shared one.
 *
 * Read per request rather than at import for the same reason rateLimit.js
 * does: this module is evaluated while index.js is still resolving its import
 * graph, which is before dotenv.config() runs, so reading eagerly would make
 * the switch depend on import order.
 */
function configuredKeys(envVar) {
  return (process.env[envVar] || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * Constant time compare.
 *
 * timingSafeEqual throws when the buffers differ in length, so the lengths are
 * checked first — which does leak the length of the key, and is fine. What must
 * not leak is how far a wrong key matched before diverging.
 */
function matches(supplied, expected) {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** First bytes of the digest — enough to tell two consumers apart in a log, not enough to replay. */
function fingerprint(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 6);
}

export function requireApiKey(envVar = 'PUBLIC_API_KEYS') {
  return (req, res, next) => {
    const keys = configuredKeys(envVar);

    // Fails closed. An unset variable means the endpoint is not open for
    // business — never that it is open to everyone.
    if (keys.length === 0) {
      return res.status(503).json({ error: 'This API is not configured.' });
    }

    // X-API-Key is the documented header; the bearer fallback is for clients
    // that only know how to send an Authorization header.
    const header = req.get('x-api-key');
    const bearer = (req.get('authorization') || '').startsWith('Bearer ')
      ? req.get('authorization').slice(7).trim()
      : null;
    const supplied = header?.trim() || bearer;

    if (!supplied || !keys.some((k) => matches(supplied, k))) {
      // Deliberately identical for missing and wrong, and never echoes the
      // value back — a reflected key ends up in logs and error trackers.
      return res.status(401).json({ error: 'Invalid or missing API key.' });
    }

    req.apiKeyLabel = fingerprint(supplied);
    next();
  };
}
