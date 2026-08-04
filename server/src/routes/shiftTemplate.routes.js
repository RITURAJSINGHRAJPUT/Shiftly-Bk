import { Router } from 'express';
import prisma from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { can } from '../lib/capabilities.js';
import { outletScope, hasGlobalScope } from '../lib/scope.js';

const router = Router();

const DEPARTMENTS = ['KITCHEN', 'SERVICE', 'HOUSEKEEPING'];

/**
 * A locked role may only touch its own outlet's patterns.
 *
 * The outlet comes from the request body, so it cannot be trusted: without this
 * a head chef could POST a template naming a different restaurant. Returns an
 * error string, or null when the write is allowed.
 */
function outletWriteDenied(req, outletId) {
  if (!outletId) return 'outletId is required';
  if (hasGlobalScope(req.user)) return null;
  if (outletId !== req.user.outletId) {
    return 'You can only manage shift patterns for your own outlet';
  }
  return null;
}

/**
 * Weekday numbers as JS `Date.getDay()` returns them, so neither the allocator
 * nor the client's week grid has to convert. Sunday is 0; the UI renders
 * Monday-first by ordering the chips itself.
 */
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** Shift rows a station can run. Mirrors MAX_SHIFT_SLOTS on the client. */
const MAX_SLOT = 6;

/**
 * Shared validation for create and update. Returns { data } or { error }.
 *
 * `currentDepartment` is the department the row already has, needed because PUT
 * is partial: a request that changes only the department still has to be judged
 * against the section already stored, and vice versa.
 */
function readTemplateBody(body, { partial = false, currentDepartment = null } = {}) {
  const {
    name, department, section, startTime, endTime, headcount, isActive, daysOfWeek, slot,
  } = body;
  const data = {};

  if (name !== undefined) data.name = String(name).trim();
  else if (!partial) return { error: 'name is required' };
  if (data.name === '') return { error: 'name cannot be empty' };

  if (department !== undefined) {
    if (!DEPARTMENTS.includes(department)) {
      return { error: `department must be one of ${DEPARTMENTS.join(', ')}` };
    }
    data.department = department;
  } else if (!partial) return { error: 'department is required' };

  // Empty string means "general" — an explicit null, not an accident.
  if (section !== undefined) data.section = section ? String(section).trim() : null;

  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const [key, value] of [['startTime', startTime], ['endTime', endTime]]) {
    if (value !== undefined) {
      if (!time.test(value)) return { error: `${key} must be HH:MM (24-hour)` };
      data[key] = value;
    } else if (!partial) return { error: `${key} is required` };
  }

  if (headcount !== undefined) {
    const n = Number(headcount);
    if (!Number.isInteger(n) || n < 1 || n > 99) {
      return { error: 'headcount must be a whole number between 1 and 99' };
    }
    data.headcount = n;
  }

  if (isActive !== undefined) data.isActive = Boolean(isActive);

  if (slot !== undefined) {
    const n = Number(slot);
    // Six, matching the sheet's ceiling. Two is the default a station draws;
    // beyond six the grid stops being readable, and a station running seven
    // distinct shifts is really two stations.
    if (!Number.isInteger(n) || n < 1 || n > MAX_SLOT) {
      return { error: `slot must be a whole number between 1 and ${MAX_SLOT}` };
    }
    data.slot = n;
  }

  if (daysOfWeek !== undefined) {
    if (!Array.isArray(daysOfWeek)) return { error: 'daysOfWeek must be an array of 0-6' };
    const days = [...new Set(daysOfWeek.map(Number))];
    if (days.some((d) => !WEEKDAYS.includes(d))) {
      return { error: 'daysOfWeek must contain only 0 (Sunday) to 6 (Saturday)' };
    }
    // A pattern that runs on no day would sit in the list looking active while
    // the allocator skipped it every single day — silently dead weight.
    if (days.length === 0) return { error: 'A pattern must run on at least one day' };
    data.daysOfWeek = days.sort((a, b) => a - b);
  }

  /**
   * Stations belong to the kitchen.
   *
   * The allocator scores `section` against `employee.skills`, and only kitchen
   * staff carry skills, so a station on a service pattern can never match — it
   * is dead data that reads like a requirement. The form disables the field, but
   * a disabled select is a suggestion; this is the part that holds.
   */
  const effectiveDepartment = data.department ?? currentDepartment;
  if (effectiveDepartment && effectiveDepartment !== 'KITCHEN') {
    if (data.section) {
      return { error: 'Stations apply to kitchen patterns only' };
    }
    // Not just when the caller sends an empty section: moving a pattern from
    // KITCHEN to SERVICE has to drop the station it is leaving behind.
    data.section = null;
  }

  return { data };
}

// GET /api/shift-templates?outlet=<id>
router.get('/', authenticateToken, async (req, res) => {
  try {
    const scope = outletScope(req);
    const where = { ...scope };

    // A global role may narrow to one outlet; a locked role is already pinned.
    if (req.query.outlet && hasGlobalScope(req.user)) {
      where.outletId = req.query.outlet;
    }
    if (req.query.activeOnly === 'true') where.isActive = true;

    const templates = await prisma.shiftTemplate.findMany({
      where,
      include: { outlet: { select: { id: true, name: true } } },
      orderBy: [{ department: 'asc' }, { startTime: 'asc' }, { name: 'asc' }],
    });

    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const CLEAR_CONFIRMATION = 'CLEAR PATTERNS';

/**
 * GET /api/shift-templates/clear-preview?outlet= — what a clear would remove.
 *
 * The pattern count is already on screen, but the shift count is not: the shift
 * list endpoint filters by the caller's own scope with no `?outlet=`, so the
 * page cannot count another restaurant's roster without pulling every shift in
 * the org. The confirmation names an exact number, so it comes from here.
 *
 * Safe under the same guard as the clear itself, so the preview can never
 * report on an outlet the caller may not touch.
 */
router.get('/clear-preview', authenticateToken, can('PATTERN_CLEAR_PREVIEW'), async (req, res) => {
  try {
    const outletId = req.query.outlet;
    const denied = outletWriteDenied(req, outletId);
    if (denied) return res.status(outletId ? 403 : 400).json({ error: denied });

    const [patterns, shifts] = await Promise.all([
      prisma.shiftTemplate.count({ where: { outletId } }),
      prisma.shift.count({ where: { outletId } }),
    ]);

    res.json({ patterns, shifts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/shift-templates/clear — remove every pattern for one outlet.
 *
 * Declared above `POST '/'` only for readability; the two paths cannot collide.
 * Scoped to a single outlet and behind a typed phrase because this is the first
 * bulk delete on either of these tables — `shift.routes.js` has only
 * `DELETE /:id`.
 *
 * Shifts are opt-in. `Shift` has no foreign key to `ShiftTemplate`, so clearing
 * patterns never orphans anything at the database level — but shifts allocated
 * from the old patterns then match none, and quietly destroying a roster on a
 * button labelled "clear patterns" would be a surprise.
 */
router.post('/clear', authenticateToken, can('PATTERN_CLEAR'), async (req, res) => {
  try {
    const { outletId, confirm, includeShifts } = req.body;

    const denied = outletWriteDenied(req, outletId);
    if (denied) return res.status(outletId ? 403 : 400).json({ error: denied });

    if (confirm !== CLEAR_CONFIRMATION) {
      return res.status(400).json({
        error: `Confirmation phrase required. Send { "confirm": "${CLEAR_CONFIRMATION}" }.`,
      });
    }

    // One transaction so the two deletes commit together: a roster left behind
    // by a half-applied clear is worse than either outcome on its own.
    const [patterns, shifts] = await prisma.$transaction([
      prisma.shiftTemplate.deleteMany({ where: { outletId } }),
      ...(includeShifts ? [prisma.shift.deleteMany({ where: { outletId } })] : []),
    ]);

    res.json({
      patterns: patterns.count,
      shifts: shifts?.count ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/shift-templates/grid — replace an outlet's week in one write.
 *
 * Shift Master edits a whole grid, so it saves as a whole: a half-applied week
 * (some stations updated, some not) is worse than either outcome, and one
 * request behaves the same whether it targets one outlet or a brand's six.
 *
 * The client merges before sending — days sharing the same row, slot, time and
 * headcount arrive as a single template with several `daysOfWeek` — so the rows
 * stored stay as compact as hand-written ones and the allocator sees exactly
 * what the grid shows.
 */
router.put('/grid', authenticateToken, can('PATTERN_GRID'), async (req, res) => {
  try {
    const { outletIds, templates } = req.body;

    if (!Array.isArray(outletIds) || outletIds.length === 0) {
      return res.status(400).json({ error: 'outletIds must be a non-empty array' });
    }
    if (!Array.isArray(templates)) {
      return res.status(400).json({ error: 'templates must be an array' });
    }

    const ids = [...new Set(outletIds)];
    const refused = ids.filter((id) => outletWriteDenied(req, id));
    if (refused.length > 0) {
      return res.status(403).json({
        error: 'You can only manage shift patterns for your own outlet',
      });
    }

    // Validated up front, before anything is deleted: reusing readTemplateBody
    // means the grid inherits the time format, headcount range, weekday and
    // kitchen-only-station rules rather than restating them.
    const rows = [];
    for (const [i, t] of templates.entries()) {
      const { data, error } = readTemplateBody(t);
      if (error) return res.status(400).json({ error: `Row ${i + 1}: ${error}` });
      rows.push({ ...data, headcount: data.headcount ?? 1 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Active only. An inactive pattern is deliberately absent from the grid,
      // so deleting it here would be silent data loss for something the user
      // parked on purpose.
      const removed = await tx.shiftTemplate.deleteMany({
        where: { outletId: { in: ids }, isActive: true },
      });
      const created = await tx.shiftTemplate.createMany({
        data: ids.flatMap((outletId) => rows.map((r) => ({ ...r, outletId }))),
      });
      const kept = await tx.shiftTemplate.count({
        where: { outletId: { in: ids }, isActive: false },
      });
      return { replaced: removed.count, created: created.count, keptInactive: kept };
    });

    res.json({ ...result, outlets: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/shift-templates/bulk — one pattern, created at many outlets.
 *
 * Separate from `POST '/'` rather than an `outletIds` branch inside it: that
 * handler answers with a single template object, and returning either an object
 * or an array depending on the request would break every existing caller's
 * expectations. This sits beside `/clear`, which already established
 * one-body-many-rows on this router.
 */
router.post('/bulk', authenticateToken, can('PATTERN_BULK'), async (req, res) => {
  try {
    const { outletIds } = req.body;

    if (!Array.isArray(outletIds) || outletIds.length === 0) {
      return res.status(400).json({ error: 'outletIds must be a non-empty array' });
    }

    const { data, error } = readTemplateBody(req.body);
    if (error) return res.status(400).json({ error });

    const ids = [...new Set(outletIds)];

    // Every id is checked, not just the first. GET /outlets applies no outlet
    // scope, so a locked user's browser holds the whole directory and could
    // offer — or a caller could simply post — an outlet they cannot write to.
    const refused = ids.filter((id) => outletWriteDenied(req, id));
    if (refused.length > 0) {
      const names = await prisma.outlet.findMany({
        where: { id: { in: refused } },
        select: { name: true },
      });
      return res.status(403).json({
        error: `You can only manage shift patterns for your own outlet` +
          (names.length ? ` (refused: ${names.map((o) => o.name).join(', ')})` : ''),
      });
    }

    const outlets = await prisma.outlet.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    if (outlets.length !== ids.length) {
      return res.status(400).json({ error: 'One or more outlets do not exist' });
    }

    // There is no unique constraint on (outletId, name), so re-running "apply to
    // all outlets" after adding one restaurant would quietly duplicate the
    // pattern everywhere else. Skipping and reporting makes it safe to repeat.
    const clashes = await prisma.shiftTemplate.findMany({
      where: { outletId: { in: ids }, name: { equals: data.name, mode: 'insensitive' } },
      select: { outletId: true },
    });
    const taken = new Set(clashes.map((c) => c.outletId));

    const targets = outlets.filter((o) => !taken.has(o.id));
    const skipped = outlets
      .filter((o) => taken.has(o.id))
      .map((o) => ({ id: o.id, name: o.name, reason: `a pattern named "${data.name}" already exists` }));

    // All or nothing: a half-applied fan-out leaves the restaurants disagreeing
    // about a pattern the user believes they created everywhere.
    const created = await prisma.$transaction(
      targets.map((o) =>
        prisma.shiftTemplate.create({
          data: { ...data, outletId: o.id, headcount: data.headcount ?? 1 },
          include: { outlet: { select: { id: true, name: true } } },
        })
      )
    );

    res.status(created.length > 0 ? 201 : 200).json({ created, skipped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shift-templates
router.post('/', authenticateToken, can('PATTERN_CREATE'), async (req, res) => {
  try {
    const { outletId } = req.body;
    const denied = outletWriteDenied(req, outletId);
    if (denied) return res.status(outletId ? 403 : 400).json({ error: denied });

    const { data, error } = readTemplateBody(req.body);
    if (error) return res.status(400).json({ error });

    const template = await prisma.shiftTemplate.create({
      data: { ...data, outletId, headcount: data.headcount ?? 1 },
      include: { outlet: { select: { id: true, name: true } } },
    });

    res.status(201).json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/shift-templates/:id
router.put('/:id', authenticateToken, can('PATTERN_EDIT'), async (req, res) => {
  try {
    const existing = await prisma.shiftTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Shift pattern not found' });

    // Check the row's current outlet, and the target one if it is being moved.
    for (const id of [existing.outletId, req.body.outletId].filter(Boolean)) {
      const denied = outletWriteDenied(req, id);
      if (denied) return res.status(403).json({ error: denied });
    }

    const { data, error } = readTemplateBody(req.body, {
      partial: true,
      currentDepartment: existing.department,
    });
    if (error) return res.status(400).json({ error });
    if (req.body.outletId) data.outletId = req.body.outletId;

    const template = await prisma.shiftTemplate.update({
      where: { id: req.params.id },
      data,
      include: { outlet: { select: { id: true, name: true } } },
    });

    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/shift-templates/:id
router.delete('/:id', authenticateToken, can('PATTERN_DELETE'), async (req, res) => {
  try {
    const existing = await prisma.shiftTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Shift pattern not found' });

    const denied = outletWriteDenied(req, existing.outletId);
    if (denied) return res.status(403).json({ error: denied });

    await prisma.shiftTemplate.delete({ where: { id: req.params.id } });
    res.json({ message: 'Shift pattern deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
