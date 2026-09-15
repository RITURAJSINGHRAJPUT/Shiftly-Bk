import { Router } from 'express';
import prisma from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { can } from '../lib/capabilities.js';
import { hasGlobalScope } from '../lib/scope.js';
import { logAudit } from '../lib/audit.js';

/**
 * The punch directory — who the biometric feed knows about.
 *
 * `PunchIdentity` is filled automatically by every attendance import, which is
 * the usual way an entry appears. These routes cover the two cases the import
 * cannot: somebody hired today who has not clocked in yet, and a name the feed
 * spells wrong.
 *
 * Reading is open to department heads, because they are the ones enrolling
 * people. Writing is head office only.
 */
const router = Router();

/**
 * Writes are head office, not "HR and above".
 *
 * `requireMinRole('HR')` would be wrong here: OUTLET_MANAGER sits at the same
 * rank as HR in ROLE_HIERARCHY, so a floor cannot separate them. The directory
 * is org-wide reference data — one outlet's manager editing it changes what
 * every other outlet sees — so the gate is global scope, which is exactly
 * SUPER_ADMIN, ADMIN and HR.
 */
function requireGlobalScope(req, res, next) {
  if (!hasGlobalScope(req.user)) {
    return res.status(403).json({ error: 'Only head office can change the punch directory' });
  }
  next();
}

/** The feed sends codes exactly as they are matched — see attendanceImport.js. */
function readCode(value) {
  const code = String(value ?? '').trim();
  if (!code) return { error: 'userid is required' };
  if (code.length > 64) return { error: 'userid is too long' };
  return { code };
}

/**
 * GET /api/directory?search=&page=&limit=&unclaimed=
 *
 * Each entry carries whoever already holds that code, so the list answers "who
 * is still to be enrolled" without a second call per row.
 */
router.get('/', authenticateToken, can('EMPLOYEE_ENROL'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const search = req.query.search?.trim();

    const where = search
      ? {
        OR: [
          { userid: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }
      : {};

    const [entries, total] = await Promise.all([
      prisma.punchIdentity.findMany({
        where,
        orderBy: [{ lastSeen: 'desc' }, { userid: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.punchIdentity.count({ where }),
    ]);

    // One query for the whole page rather than one per row.
    const holders = await prisma.employee.findMany({
      where: { employeeCode: { in: entries.map((e) => e.userid) } },
      select: {
        employeeCode: true, name: true, isActive: true, outletId: true,
        outlet: { select: { name: true } },
      },
    });
    const holderByCode = new Map(holders.map((h) => [h.employeeCode, h]));

    const rows = entries.map((e) => {
      const holder = holderByCode.get(e.userid);
      // A locked role sees that a code is taken, but not by whom, when the
      // holder is at another restaurant — matching GET /employees/lookup.
      const mine = holder && (hasGlobalScope(req.user) || holder.outletId === req.user.outletId);
      return {
        userid: e.userid,
        name: e.name,
        punchCount: e.punchCount,
        lastSeen: e.lastSeen,
        claimedBy: holder
          ? (mine
            ? { name: holder.name, outlet: holder.outlet?.name ?? null, isActive: holder.isActive }
            : { name: null, outlet: null, isActive: holder.isActive })
          : null,
      };
    });

    res.json({ entries: rows, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Directory list error:', err);
    res.status(500).json({ error: 'Failed to load the directory' });
  }
});

/** POST /api/directory — add someone the feed has not seen yet. */
router.post('/', authenticateToken, requireGlobalScope, async (req, res) => {
  try {
    const { code, error } = readCode(req.body?.userid);
    if (error) return res.status(400).json({ error });

    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const existing = await prisma.punchIdentity.findUnique({ where: { userid: code } });
    if (existing) {
      return res.status(400).json({ error: `${code} is already in the directory` });
    }

    const entry = await prisma.punchIdentity.create({
      // Zero punches and now: this person has never clocked in, which is the
      // whole reason the entry has to be made by hand. The next import
      // overwrites both with what the feed actually reports.
      data: { userid: code, name, punchCount: 0, lastSeen: new Date() },
    });

    logAudit({
      action: 'DIRECTORY_ADD', entity: 'PunchIdentity', entityId: code,
      actor: req.user, details: { name },
    });

    res.status(201).json(entry);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'That code is already in the directory' });
    }
    console.error('Directory create error:', err);
    res.status(500).json({ error: 'Failed to add the entry' });
  }
});

/**
 * PUT /api/directory/:userid — correct a name.
 *
 * The code itself is the primary key and is what attendance matches on, so it
 * is not editable: changing it would orphan the punches already filed under it.
 * A wrong code is a new entry, not an edit.
 */
router.put('/:userid', authenticateToken, requireGlobalScope, async (req, res) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const entry = await prisma.punchIdentity.update({
      where: { userid: req.params.userid },
      data: { name },
    });

    logAudit({
      action: 'DIRECTORY_EDIT', entity: 'PunchIdentity', entityId: entry.userid,
      actor: req.user, details: { name },
    });

    res.json(entry);
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'No such entry in the directory' });
    }
    console.error('Directory update error:', err);
    res.status(500).json({ error: 'Failed to update the entry' });
  }
});

export default router;
