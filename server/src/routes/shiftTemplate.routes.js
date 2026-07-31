import { Router } from 'express';
import prisma from '../db.js';
import { authenticateToken, requireMinRole } from '../middleware/auth.js';
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

/** Shared validation for create and update. Returns { data } or { error }. */
function readTemplateBody(body, { partial = false } = {}) {
  const { name, department, section, startTime, endTime, headcount, isActive } = body;
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

// POST /api/shift-templates
router.post('/', authenticateToken, requireMinRole('HEAD_CHEF'), async (req, res) => {
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
router.put('/:id', authenticateToken, requireMinRole('HEAD_CHEF'), async (req, res) => {
  try {
    const existing = await prisma.shiftTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Shift pattern not found' });

    // Check the row's current outlet, and the target one if it is being moved.
    for (const id of [existing.outletId, req.body.outletId].filter(Boolean)) {
      const denied = outletWriteDenied(req, id);
      if (denied) return res.status(403).json({ error: denied });
    }

    const { data, error } = readTemplateBody(req.body, { partial: true });
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
router.delete('/:id', authenticateToken, requireMinRole('HEAD_CHEF'), async (req, res) => {
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
