import { Router } from 'express';
import prisma from '../db.js';
import { requireApiKey } from '../middleware/apiKey.js';
import { publicApiLimiter } from '../middleware/rateLimit.js';
import { publicCors } from '../middleware/publicCors.js';

/**
 * The public integration API.
 *
 * Read only, no JWT, no user — an API key stands in for the caller. Because
 * there is no user there is also no outletScope() to lean on: that helper reads
 * req.user, and a key is not pinned to an outlet. Scope here comes from the
 * query params alone, applied to Outlet rather than Employee, since the whole
 * shape of the response is outlet first.
 */
const router = Router();

/**
 * CORS first, then the gates.
 *
 * The order is load-bearing. A browser preflights this endpoint because
 * X-API-Key is a custom header — and a preflight is an OPTIONS request that
 * deliberately carries no custom headers, so it has no key on it. With
 * requireApiKey ahead of cors(), every preflight would be answered 401 and the
 * real request would never be sent: the consumer sees "CORS error" and nothing
 * in the logs says the key check is what did it. cors() short-circuits OPTIONS
 * with a 204 before either gate runs.
 *
 * On the router rather than each route, so anything added to this file later
 * cannot be published by accident.
 */
router.use(publicCors);

/**
 * End every preflight here, allowed or not.
 *
 * cors() ends an *allowed* preflight itself, but when the origin callback says
 * no it calls next() and never enters its OPTIONS branch at all (cors/lib/index.js:219)
 * — so a rejected preflight would fall through to the gates below and answer
 * 401. The browser blocks it either way, since what it checks for is the
 * missing Access-Control-Allow-Origin header rather than the status. The
 * problem is the log line: a preflight recorded as an auth failure sends
 * whoever is debugging after the key when the origin list is the actual cause.
 *
 * Express 5 rejects `router.options('*')` — the bare wildcard is no longer a
 * valid path pattern and throws at startup — so this is plain middleware.
 */
router.use((req, res, next) => {
  if (req.method === 'OPTIONS') return res.status(204).set('Content-Length', '0').end();
  next();
});

router.use(publicApiLimiter, requireApiKey);

/**
 * Administration is not published.
 *
 * These are the org level accounts — the people who can create outlets, reset
 * passwords and read the audit log. They are staff of the business, not staff
 * of an outlet, and an integrator asking for a roster has no use for them.
 *
 * Excluded by role rather than by whether they happen to have an outlet: today
 * every one of them has outletId null and would fall out of an outlet grouped
 * response anyway, but assigning an HR to an outlet is a supported thing to do
 * and must not quietly publish them.
 */
const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];
const PUBLIC_ROLES = ['OUTLET_MANAGER', 'MASTER_OF_HOUSE', 'HEAD_CHEF', 'STAFF'];
const DEPARTMENTS = ['KITCHEN', 'SERVICE', 'HOUSEKEEPING'];

/**
 * An allowlist, not a denylist.
 *
 * The internal routes strip the password by destructuring it out, which means
 * every column added to Employee from now on is published by default. On a
 * surface anyone with a key can read, the default has to be the other way
 * round: email, phone, avatar and the password hash are absent because they
 * were never named.
 */
const STAFF_FIELDS = {
  id: true,
  employeeCode: true,
  name: true,
  role: true,
  department: true,
  skills: true,
  isActive: true,
  joinDate: true,
};

/**
 * GET /api/public/staff — every outlet with its roster nested inside.
 *
 * Not paginated. The grouping is the point, and the data is bounded by the
 * number of outlets a business actually operates.
 */
router.get('/staff', async (req, res) => {
  try {
    const { outlet, brand, org, department, role } = req.query;
    const includeInactive = req.query.includeInactive === 'true';

    // Checked here rather than left to Prisma: an unknown enum value makes the
    // client throw, and a thrown Prisma error on a public endpoint is a 500
    // where the caller deserves a 400 telling them what they got wrong.
    if (department && !DEPARTMENTS.includes(department)) {
      return res.status(400).json({ error: `Unknown department. Expected one of: ${DEPARTMENTS.join(', ')}` });
    }
    // An administration role here is a 400 rather than an empty result: asking
    // for something this endpoint will never return is a mistake worth naming,
    // and silence would read as "there are no admins".
    if (role && !PUBLIC_ROLES.includes(role)) {
      return res.status(400).json({
        error: ADMIN_ROLES.includes(role)
          ? `Administration roles are not exposed by this API. Expected one of: ${PUBLIC_ROLES.join(', ')}`
          : `Unknown role. Expected one of: ${PUBLIC_ROLES.join(', ')}`,
      });
    }

    const staffWhere = {
      // One key, so a caller's role can only ever narrow the allowlist rather
      // than replace it. Spreading `...(role ? { role } : {})` after a separate
      // `role: { in: PUBLIC_ROLES }` would overwrite the exclusion outright —
      // harmless while the validation above holds, but the exclusion should not
      // depend on a check several lines away staying correct.
      role: { in: role ? [role] : PUBLIC_ROLES },
      ...(includeInactive ? {} : { isActive: true }),
      ...(department ? { department } : {}),
    };

    const outlets = await prisma.outlet.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(outlet ? { id: outlet } : {}),
        ...(brand ? { brandId: brand } : {}),
        ...(org ? { brand: { organizationId: org } } : {}),
      },
      select: {
        id: true,
        name: true,
        address: true,
        isActive: true,
        // Selected field by field rather than via outletInclude: that include
        // returns the whole outlet row, and latitude/longitude/radius are the
        // attendance geofence. Publishing them tells anyone exactly where to
        // stand — or what to spoof — to clock in.
        brand: {
          select: {
            id: true,
            name: true,
            organization: { select: { id: true, name: true } },
          },
        },
        employees: {
          where: staffWhere,
          select: STAFF_FIELDS,
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Outlets with no matching staff are kept, with an empty array: a consumer
    // mirroring the outlet list needs to see the quiet ones too.
    const payload = outlets.map(({ brand: b, employees, ...rest }) => ({
      ...rest,
      brand: b ? { id: b.id, name: b.name } : null,
      organization: b?.organization ?? null,
      staffCount: employees.length,
      staff: employees,
    }));

    /**
     * Five minutes.
     *
     * This is called by every visitor to the consumer's website, not by a
     * handful of signed-in staff, and it runs on a free Render instance in
     * front of a free Supabase pooler. A roster changes a few times a week, so
     * letting browsers reuse the response is the difference between one query
     * per page view and one per five minutes.
     */
    res.set('Cache-Control', 'public, max-age=300');

    res.json({
      generatedAt: new Date().toISOString(),
      outletCount: payload.length,
      staffCount: payload.reduce((n, o) => n + o.staffCount, 0),
      outlets: payload,
    });
  } catch (err) {
    // Generic on purpose. Most routers here return err.message, which on a
    // Prisma failure spells out column and model names to whoever asked.
    console.error('Public staff fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
