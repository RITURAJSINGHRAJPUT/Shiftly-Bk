import crypto from 'crypto';

/**
 * Shared-secret gate for the public integration API.
 *
 * Everything else in this app is behind a JWT that pins the caller to a role
 * and an outlet. The public routes have no user at all, so they need their own
 * key — a value handed to an integrator, not minted by logging in.
 *
 * Keys live in PUBLIC_API_KEYS, comma separated. Read per request rather than
 * at import for the same reason rateLimit.js does: this module is evaluated
 * while index.js is still resolving its import graph, which is before
 * dotenv.config() runs, so reading eagerly would make the switch depend on
 * import order.
 */
function configuredKeys() {
  return (process.env.PUBLIC_API_KEYS || '')
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

export function requireApiKey(req, res, next) {
  const keys = configuredKeys();

  // Fails closed. An unset variable means the endpoint is not open for
  // business — never that it is open to everyone.
  if (keys.length === 0) {
    return res.status(503).json({ error: 'Public API is not configured.' });
  }

  // X-API-Key is the documented header; the bearer fallback is for clients that
  // only know how to send an Authorization header.
  const header = req.get('x-api-key');
  const bearer = (req.get('authorization') || '').startsWith('Bearer ')
    ? req.get('authorization').slice(7).trim()
    : null;
  const supplied = header?.trim() || bearer;

  if (!supplied || !keys.some((k) => matches(supplied, k))) {
    // Deliberately identical for missing and wrong, and never echoes the value
    // back — a reflected key ends up in logs and error trackers.
    return res.status(401).json({ error: 'Invalid or missing API key.' });
  }

  req.apiKeyLabel = fingerprint(supplied);
  next();
}
