import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

/**
 * No fallback, deliberately.
 *
 * This used to default to a literal published in this repository, so any
 * deployment that forgot the variable signed tokens with a value anyone could
 * read — and did it silently, looking entirely healthy. Failing to boot is the
 * only safe behaviour: a missing secret is a broken deployment, not a default.
 */
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    'JWT_SECRET is not set. Refusing to start — without it every token would be ' +
    'signed with a predictable value and could be forged. Set it in server/.env.'
  );
}

// Role hierarchy for permission checks
export const ROLE_HIERARCHY = {
  SUPER_ADMIN: 6,
  ADMIN: 5,
  HR: 4,
  MASTER_OF_HOUSE: 3,
  HEAD_CHEF: 2,
  STAFF: 1,
};

/**
 * Payload version. Bumped when a claim changes shape.
 *
 * v2 renamed `venueId` to `outletId`. A v1 token presented after that rename
 * yields `req.user.outletId === undefined`, and Prisma treats
 * `where: { outletId: undefined }` as "no filter" — so a stale token would have
 * widened a locked role's scope to every outlet instead of narrowing it. Tokens
 * below the current version are rejected outright.
 *
 * v3 added the `pwreset` claim. A v2 token carries none, so it would read as an
 * unrestricted session and walk straight past the forced-password-change gate.
 */
const TOKEN_VERSION = 3;

/**
 * @param employee            the row being signed in
 * @param opts.passwordReset  restrict this token to setting a password
 */
export function generateToken(employee, { passwordReset = false } = {}) {
  return jwt.sign(
    {
      v: TOKEN_VERSION,
      id: employee.id,
      role: employee.role,
      outletId: employee.outletId,
      // Present only when restricted, so an ordinary token stays as it was.
      ...(passwordReset && { pwreset: true }),
    },
    JWT_SECRET,
    // A token that can only set a password has no business lasting a week.
    { expiresIn: passwordReset ? '1h' : '7d' }
  );
}

/** Shared verification. Returns the payload, or sends the response and null. */
function decode(req, res) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // 401, not 403: the client only clears a dead token on 401. Returning 403
    // here would leave the stale token in place and silently fail every request.
    if (decoded.v !== TOKEN_VERSION) {
      res.status(401).json({ error: 'Session outdated — please sign in again' });
      return null;
    }
    return decoded;
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
}

/**
 * The ordinary guard. Refuses a password-reset token.
 *
 * Enforced here rather than by the client agreeing to show a set-password
 * screen: the restriction travels inside the signed token, so an account with a
 * temporary password cannot reach a single endpoint by skipping the UI. It also
 * costs no database read — the claim is already in the payload.
 */
export function authenticateToken(req, res, next) {
  const decoded = decode(req, res);
  if (!decoded) return;

  if (decoded.pwreset) {
    return res.status(403).json({
      code: 'PASSWORD_RESET_REQUIRED',
      error: 'Set your own password before using Bookends Shiftly',
    });
  }

  req.user = decoded;
  next();
}

/**
 * Accepts both kinds. Only for the two routes a half-signed-in account needs:
 * reading who it is, and setting its password.
 */
export function authenticateResettable(req, res, next) {
  const decoded = decode(req, res);
  if (!decoded) return;
  req.user = decoded;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

export function requireMinRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const userLevel = ROLE_HIERARCHY[req.user.role] || 0;
    const requiredLevel = ROLE_HIERARCHY[minRole] || 0;
    if (userLevel < requiredLevel) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
