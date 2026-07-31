import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'shiftly-secret';

// Role hierarchy for permission checks
const ROLE_HIERARCHY = {
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
 */
const TOKEN_VERSION = 2;

export function generateToken(employee) {
  return jwt.sign(
    {
      v: TOKEN_VERSION,
      id: employee.id,
      role: employee.role,
      outletId: employee.outletId,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token required' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // 401, not 403: the client only clears a dead token on 401. Returning 403
    // here would leave the stale token in place and silently fail every request.
    if (decoded.v !== TOKEN_VERSION) {
      return res.status(401).json({ error: 'Session outdated — please sign in again' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
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
