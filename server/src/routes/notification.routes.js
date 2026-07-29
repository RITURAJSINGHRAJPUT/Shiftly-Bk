import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

// GET /api/notifications — get my notifications
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { unreadOnly } = req.query;
    const where = { employeeId: req.user.id };
    if (unreadOnly === 'true') where.isRead = false;

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/notifications/count — unread count
router.get('/count', authenticateToken, async (req, res) => {
  try {
    const count = await prisma.notification.count({
      where: { employeeId: req.user.id, isRead: false },
    });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notifications/:id/read — mark as read
router.put('/:id/read', authenticateToken, async (req, res) => {
  try {
    const notification = await prisma.notification.update({
      where: { id: req.params.id },
      data: { isRead: true },
    });
    res.json(notification);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notifications/read-all — mark all as read
router.put('/read-all', authenticateToken, async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { employeeId: req.user.id, isRead: false },
      data: { isRead: true },
    });
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/venues
router.get('/venues', authenticateToken, async (req, res) => {
  try {
    const venues = await prisma.venue.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json(venues);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/venues/:id
router.put('/venues/:id', authenticateToken, async (req, res) => {
  try {
    const { name, latitude, longitude, radius, address } = req.body;
    const venue = await prisma.venue.update({
      where: { id: req.params.id },
      data: { name, latitude, longitude, radius, address },
    });
    res.json(venue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/stats
router.get('/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const [
      totalEmployees,
      todayShifts,
      todayAttendance,
      pendingLeaves,
      emergencyLeaves,
      weekShifts,
    ] = await Promise.all([
      prisma.employee.count({ where: { isActive: true } }),
      prisma.shift.count({ where: { date: { gte: today, lt: tomorrow } } }),
      prisma.attendance.count({ where: { date: { gte: today, lt: tomorrow }, status: { in: ['CHECKED_IN', 'CHECKED_OUT'] } } }),
      prisma.leave.count({ where: { status: 'PENDING' } }),
      prisma.leave.count({ where: { isEmergency: true, status: 'COVERAGE_PENDING' } }),
      prisma.shift.count({ where: { date: { gte: weekStart, lt: weekEnd } } }),
    ]);

    const attendanceRate = todayShifts > 0 ? Math.round((todayAttendance / todayShifts) * 100) : 0;

    res.json({
      totalEmployees,
      todayShifts,
      todayAttendance,
      attendanceRate,
      pendingLeaves,
      emergencyLeaves,
      weekShifts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
