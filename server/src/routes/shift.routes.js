import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, requireMinRole } from '../middleware/auth.js';
import { autoAllocateShifts } from '../engine/shiftAllocator.js';

const router = Router();
const prisma = new PrismaClient();

// GET /api/shifts — list shifts with filters
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { venue, date, startDate, endDate, employee, status } = req.query;
    const where = {};

    if (venue) where.venueId = venue;
    if (employee) where.employeeId = employee;
    if (status) where.status = status;
    if (date) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      where.date = { gte: d, lt: next };
    } else if (startDate && endDate) {
      where.date = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    // Non-admin: only own venue
    if (!['SUPER_ADMIN', 'ADMIN', 'HR'].includes(req.user.role)) {
      where.venueId = req.user.venueId;
    }

    const shifts = await prisma.shift.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, department: true, skills: true, avatar: true } },
        venue: { select: { id: true, name: true } },
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
    const { date, startTime, endTime, section, employeeId, venueId } = req.body;

    const shift = await prisma.shift.create({
      data: {
        date: new Date(date),
        startTime,
        endTime,
        section,
        employeeId,
        venueId: venueId || req.user.venueId,
      },
      include: {
        employee: { select: { id: true, name: true } },
        venue: { select: { id: true, name: true } },
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
    const { venueId, startDate, endDate } = req.body;
    const result = await autoAllocateShifts(
      prisma,
      venueId || req.user.venueId,
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
    if (date) data.date = new Date(date);
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
        venue: { select: { id: true, name: true } },
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
        venue: { select: { name: true } },
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
