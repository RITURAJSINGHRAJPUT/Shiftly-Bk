import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth.js';
import { processCheckIn, processCheckOut } from '../engine/geoAttendance.js';

const router = Router();
const prisma = new PrismaClient();

// POST /api/attendance/check-in
router.post('/check-in', authenticateToken, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Location coordinates are required' });
    }
    const result = await processCheckIn(prisma, req.user.id, latitude, longitude);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/attendance/check-out
router.post('/check-out', authenticateToken, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Location coordinates are required' });
    }
    const result = await processCheckOut(prisma, req.user.id, latitude, longitude);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/attendance/today — get current user's attendance today
router.get('/today', authenticateToken, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await prisma.attendance.findUnique({
      where: {
        employeeId_date: {
          employeeId: req.user.id,
          date: today,
        },
      },
    });

    res.json(attendance || { status: 'NOT_CHECKED_IN' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance — list attendance records (admin)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { date, startDate, endDate, employee, venue, status } = req.query;
    const where = {};

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

    // Filter by venue through employee relation
    const include = {
      employee: {
        select: { id: true, name: true, department: true, venueId: true, venue: { select: { name: true } } },
      },
    };

    let records = await prisma.attendance.findMany({
      where,
      include,
      orderBy: { date: 'desc' },
      take: 200,
    });

    // Filter by venue if specified
    if (venue) {
      records = records.filter(r => r.employee.venueId === venue);
    }

    // Non-admin: only own venue
    if (!['SUPER_ADMIN', 'ADMIN', 'HR', 'MASTER_OF_HOUSE'].includes(req.user.role)) {
      records = records.filter(r => r.employeeId === req.user.id);
    }

    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance/stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [checkedIn, late, absent, total] = await Promise.all([
      prisma.attendance.count({
        where: { date: { gte: today, lt: tomorrow }, status: { in: ['CHECKED_IN', 'CHECKED_OUT'] } },
      }),
      prisma.attendance.count({
        where: { date: { gte: today, lt: tomorrow }, status: 'LATE' },
      }),
      prisma.attendance.count({
        where: { date: { gte: today, lt: tomorrow }, status: 'ABSENT' },
      }),
      prisma.employee.count({ where: { isActive: true } }),
    ]);

    res.json({ checkedIn, late, absent, total, notCheckedIn: total - checkedIn - late - absent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
