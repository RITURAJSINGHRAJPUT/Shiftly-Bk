import { Router } from 'express';
import prisma from '../db.js';
import { authenticateToken, requireMinRole } from '../middleware/auth.js';
import { autoAllocateShifts } from '../engine/shiftAllocator.js';
import { outletScope } from '../lib/scope.js';
import { localDateRange, startOfLocalDay, localDateKey } from '../lib/dates.js';

const router = Router();

/** Outlet summary shape reused across this router's responses. */
const outletSelect = {
  select: { id: true, name: true, brand: { select: { id: true, name: true } } },
};

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
router.post('/', authenticateToken, requireMinRole('HEAD_CHEF'), async (req, res) => {
  try {
    const { date, startTime, endTime, section, employeeId, outletId } = req.body;

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
        outletId: outletId || req.user.outletId,
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

    res.status(201).json(shift);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shifts/auto-allocate
router.post('/auto-allocate', authenticateToken, requireMinRole('HEAD_CHEF'), async (req, res) => {
  try {
    const { outletId, startDate, endDate } = req.body;
    const result = await autoAllocateShifts(
      prisma,
      outletId || req.user.outletId,
      startDate,
      endDate
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/shifts/:id
router.put('/:id', authenticateToken, requireMinRole('HEAD_CHEF'), async (req, res) => {
  try {
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
router.delete('/:id', authenticateToken, requireMinRole('ADMIN'), async (req, res) => {
  try {
    await prisma.shift.delete({ where: { id: req.params.id } });
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
