import { Router } from 'express';
import prisma from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { can, canOrOutletManager } from '../lib/capabilities.js';
import { autoAllocateShifts } from '../engine/shiftAllocator.js';
import { outletScope, hasGlobalScope } from '../lib/scope.js';
import { localDateRange, startOfLocalDay, localDateKey } from '../lib/dates.js';
import { logAudit } from '../lib/audit.js';

const router = Router();

/** Outlet summary shape reused across this router's responses. */
const outletSelect = {
  select: { id: true, name: true, brand: { select: { id: true, name: true } } },
};

/**
 * A locked role (Head Chef, Master of House, Outlet Manager) may only touch
 * shifts at their own outlet. Global roles pass unconditionally. Returns an
 * error string, or null when the write is allowed.
 *
 * None of create/edit/delete/auto-allocate checked this before — outletId
 * came straight from the request body with no verification it matched the
 * caller's own outlet, so any locked role could already act on another
 * outlet's shifts by supplying its id.
 */
function outletShiftDenied(req, outletId) {
  if (hasGlobalScope(req.user)) return null;
  if (!outletId || outletId !== req.user.outletId) {
    return 'You can only manage shifts for your own outlet';
  }
  return null;
}

// GET /api/shifts — list shifts with filters
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { date, startDate, endDate, employee, status } = req.query;
    const where = { ...outletScope(req) };

    if (employee) where.employeeId = employee;
    if (status) where.status = status;
    // Local-day bounds. `new Date('2026-07-27')` is UTC midnight, which sits
    // after a row stored at local midnight east of UTC — that dropped the first
    // day of every range.
    if (date) {
      where.date = localDateRange(date);
    } else if (startDate && endDate) {
      where.date = localDateRange(startDate, endDate);
    }

    const shifts = await prisma.shift.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, department: true, skills: true, avatar: true } },
        outlet: outletSelect,
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });

    res.json(shifts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shifts — create a shift manually
router.post('/', authenticateToken, can('SHIFT_CREATE'), async (req, res) => {
  try {
    const { date, startTime, endTime, section, employeeId, outletId } = req.body;
    const targetOutletId = outletId || req.user.outletId;
    const denied = outletShiftDenied(req, targetOutletId);
    if (denied) return res.status(403).json({ error: denied });

    // A shift carries no department of its own — it inherits the one the person
    // works in. Stations are a kitchen concept (only kitchen staff hold the
    // skills the allocator scores them against), so a station on a service
    // shift is dead data that still paints a station tag on the week grid.
    if (section) {
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { name: true, department: true },
      });
      if (!employee) return res.status(400).json({ error: 'Employee not found' });
      if (employee.department !== 'KITCHEN') {
        return res.status(400).json({
          error: `${employee.name} works in ${employee.department} — stations apply to kitchen shifts only`,
        });
      }
    }

    const shift = await prisma.shift.create({
      data: {
        // Local midnight, matching the seeder and the allocator. A bare
        // `new Date('2026-07-27')` would land at 05:30 local and break the
        // exact-equality `date:` lookups in the emergency-leave flow.
        date: startOfLocalDay(date),
        startTime,
        endTime,
        section,
        employeeId,
        outletId: targetOutletId,
      },
      include: {
        employee: { select: { id: true, name: true } },
        outlet: outletSelect,
      },
    });

    // Notify employee
    await prisma.notification.create({
      data: {
        employeeId,
        type: 'SHIFT_ASSIGNED',
        title: 'New Shift Assigned',
        message: `You've been assigned a ${section || 'general'} shift on ${new Date(date).toLocaleDateString()} (${startTime}-${endTime}).`,
      },
    });

    logAudit({ action: 'SHIFT_CREATE', entity: 'Shift', entityId: shift.id, actor: req.user, details: { employeeName: shift.employee?.name, date, section } });

    res.status(201).json(shift);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shifts/auto-allocate
router.post('/auto-allocate', authenticateToken, can('SHIFT_ALLOCATE'), async (req, res) => {
  try {
    const { outletId, startDate, endDate } = req.body;
    const targetOutletId = outletId || req.user.outletId;
    const denied = outletShiftDenied(req, targetOutletId);
    if (denied) return res.status(403).json({ error: denied });

    const result = await autoAllocateShifts(prisma, targetOutletId, startDate, endDate);

    logAudit({ action: 'SHIFT_ALLOCATE', entity: 'Shift', actor: req.user, details: { outletId: targetOutletId, count: result.count, startDate, endDate } });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/shifts/:id
router.put('/:id', authenticateToken, can('SHIFT_EDIT'), async (req, res) => {
  try {
    const existing = await prisma.shift.findUnique({ where: { id: req.params.id }, select: { outletId: true } });
    if (!existing) return res.status(404).json({ error: 'Shift not found' });
    const denied = outletShiftDenied(req, existing.outletId);
    if (denied) return res.status(403).json({ error: denied });

    const { date, startTime, endTime, section, employeeId, status } = req.body;
    const data = {};
    if (date) data.date = startOfLocalDay(date);
    if (startTime) data.startTime = startTime;
    if (endTime) data.endTime = endTime;
    if (section !== undefined) data.section = section;
    if (employeeId) data.employeeId = employeeId;
    if (status) data.status = status;

    const shift = await prisma.shift.update({
      where: { id: req.params.id },
      data,
      include: {
        employee: { select: { id: true, name: true } },
        outlet: outletSelect,
      },
    });

    res.json(shift);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/shifts/:id
router.delete('/:id', authenticateToken, canOrOutletManager('SHIFT_DELETE'), async (req, res) => {
  try {
    const existing = await prisma.shift.findUnique({ where: { id: req.params.id }, select: { outletId: true } });
    if (!existing) return res.status(404).json({ error: 'Shift not found' });
    const denied = outletShiftDenied(req, existing.outletId);
    if (denied) return res.status(403).json({ error: denied });

    await prisma.shift.delete({ where: { id: req.params.id } });

    logAudit({ action: 'SHIFT_DELETE', entity: 'Shift', entityId: req.params.id, actor: req.user });

    res.json({ message: 'Shift deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shifts/my — get current user's shifts
router.get('/my/upcoming', authenticateToken, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const shifts = await prisma.shift.findMany({
      where: {
        employeeId: req.user.id,
        date: { gte: today },
        status: 'ASSIGNED',
      },
      include: {
        outlet: { select: { name: true } },
      },
      orderBy: { date: 'asc' },
      take: 14,
    });

    res.json(shifts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
