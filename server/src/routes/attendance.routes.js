import { Router } from 'express';
import prisma from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { processCheckIn, processCheckOut } from '../engine/geoAttendance.js';
import { employeeScope, hasGlobalScope } from '../lib/scope.js';
import { localDateRange } from '../lib/dates.js';

const router = Router();

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

/** Roles allowed to see attendance beyond their own record. */
const ATTENDANCE_VIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR', 'MASTER_OF_HOUSE'];

// GET /api/attendance — list attendance records
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { date, startDate, endDate, employee, status } = req.query;

    // Scope in the query, not after the fact. The previous version took 200
    // rows and then filtered in JS, so a staff user whose records fell outside
    // that first page saw nothing at all.
    const where = { ...employeeScope(req) };

    if (!ATTENDANCE_VIEWER_ROLES.includes(req.user.role)) {
      where.employeeId = req.user.id;
    } else if (employee) {
      where.employeeId = employee;
    }

    if (status) where.status = status;

    // Local-day bounds — see lib/dates.js for why not `new Date(str)`.
    if (date) {
      where.date = localDateRange(date);
    } else if (startDate && endDate) {
      where.date = localDateRange(startDate, endDate);
    }

    const records = await prisma.attendance.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            department: true,
            outletId: true,
            outlet: { select: { name: true, brand: { select: { name: true } } } },
          },
        },
      },
      orderBy: { date: 'desc' },
      take: 200,
    });

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

    const scope = employeeScope(req);
    const day = { gte: today, lt: tomorrow };

    const [checkedIn, late, absent, total] = await Promise.all([
      prisma.attendance.count({
        where: { ...scope, date: day, status: { in: ['CHECKED_IN', 'CHECKED_OUT'] } },
      }),
      prisma.attendance.count({ where: { ...scope, date: day, status: 'LATE' } }),
      prisma.attendance.count({ where: { ...scope, date: day, status: 'ABSENT' } }),
      prisma.employee.count({
        where: { isActive: true, ...(scope.employee ?? {}) },
      }),
    ]);

    res.json({
      checkedIn,
      late,
      absent,
      total,
      // LATE is a form of present, so it is counted here rather than left in
      // the not-checked-in bucket.
      present: checkedIn + late,
      notCheckedIn: Math.max(0, total - checkedIn - late - absent),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
