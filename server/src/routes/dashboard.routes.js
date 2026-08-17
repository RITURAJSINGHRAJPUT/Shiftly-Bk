import { Router } from 'express';
import prisma from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { outletScope, employeeScope, hasGlobalScope, MATCH_NOTHING } from '../lib/scope.js';

const router = Router();

/** Midnight today, and the same instant tomorrow, in server-local time. */
function dayBounds(offsetDays = 0) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + offsetDays);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/**
 * YYYY-MM-DD from a Date's *local* parts.
 *
 * Not `toISOString().split('T')[0]` — these Dates are local midnights, and
 * converting to UTC shifts them into the previous day at any positive offset
 * (local 00:00 on the 27th in IST is 18:30Z on the 26th), which would label
 * every point on the trend chart one day early.
 */
function localDateKey(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// GET /api/dashboard/stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const empWhere = { isActive: true, ...outletScope(req) };
    const shiftWhere = outletScope(req);
    const attWhere = employeeScope(req);
    const leaveWhere = employeeScope(req);
    const globalScope = hasGlobalScope(req.user);
    // A locked user is pinned to exactly one outlet, so their brand/outlet
    // "totals" are just whether that outlet still exists and is active —
    // not a count across the org they cannot see the rest of.
    const ownOutletActive = globalScope
      ? null
      : prisma.outlet.count({ where: { id: req.user.outletId || MATCH_NOTHING, isActive: true } });

    const { start: today, end: tomorrow } = dayBounds();
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const [
      totalEmployees,
      totalBrands,
      totalOutlets,
      todayShifts,
      todayAttendance,
      pendingLeaves,
      emergencyLeaves,
      weekShifts,
    ] = await Promise.all([
      prisma.employee.count({ where: empWhere }),
      globalScope ? prisma.brand.count({ where: { isActive: true } }) : ownOutletActive,
      globalScope ? prisma.outlet.count({ where: { isActive: true } }) : ownOutletActive,
      prisma.shift.count({ where: { ...shiftWhere, date: { gte: today, lt: tomorrow } } }),
      prisma.attendance.count({
        where: {
          ...attWhere,
          date: { gte: today, lt: tomorrow },
          status: { in: ['CHECKED_IN', 'CHECKED_OUT', 'LATE'] },
        },
      }),
      prisma.leave.count({ where: { ...leaveWhere, status: 'PENDING' } }),
      prisma.leave.count({
        where: { ...leaveWhere, isEmergency: true, status: 'COVERAGE_PENDING' },
      }),
      prisma.shift.count({ where: { ...shiftWhere, date: { gte: weekStart, lt: weekEnd } } }),
    ]);

    const attendanceRate = todayShifts > 0
      ? Math.round((todayAttendance / todayShifts) * 100)
      : 0;

    res.json({
      totalEmployees,
      totalBrands,
      totalOutlets,
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

// GET /api/dashboard/attendance-trend?days=7
//
// Attendance rate per day = present / scheduled. LATE counts as present; an
// employee who turned up late still turned up.
router.get('/attendance-trend', authenticateToken, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 31);
    const shiftWhere = outletScope(req);
    const attWhere = employeeScope(req);

    const series = [];
    for (let i = days - 1; i >= 0; i--) {
      const { start, end } = dayBounds(-i);
      const [scheduled, present] = await Promise.all([
        prisma.shift.count({ where: { ...shiftWhere, date: { gte: start, lt: end } } }),
        prisma.attendance.count({
          where: {
            ...attWhere,
            date: { gte: start, lt: end },
            status: { in: ['CHECKED_IN', 'CHECKED_OUT', 'LATE'] },
          },
        }),
      ]);

      series.push({
        date: localDateKey(start),
        attendance: scheduled > 0 ? Math.round((present / scheduled) * 100) : null,
        scheduled,
        present,
      });
    }

    res.json({ series, target: 95 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/brand-performance
//
// Attendance rate for the current week, grouped by brand.
router.get('/brand-performance', authenticateToken, async (req, res) => {
  try {
    const { start: today } = dayBounds();
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const globalScope = hasGlobalScope(req.user);

    const brands = await prisma.brand.findMany({
      where: {
        isActive: true,
        ...(globalScope ? {} : { outlets: { some: { id: req.user.outletId || MATCH_NOTHING } } }),
      },
      include: { outlets: { select: { id: true } } },
      orderBy: { name: 'asc' },
    });

    const rows = await Promise.all(
      brands.map(async (brand) => {
        // A locked user's own row still only counts their own outlet, not
        // every sibling outlet under the same brand.
        const outletIds = globalScope
          ? brand.outlets.map((o) => o.id)
          : brand.outlets.filter((o) => o.id === req.user.outletId).map((o) => o.id);
        if (outletIds.length === 0) {
          return { brand: brand.name, attendance: 0, scheduled: 0, present: 0 };
        }

        const [scheduled, present] = await Promise.all([
          prisma.shift.count({
            where: { outletId: { in: outletIds }, date: { gte: weekStart, lt: weekEnd } },
          }),
          prisma.attendance.count({
            where: {
              employee: { outletId: { in: outletIds } },
              date: { gte: weekStart, lt: weekEnd },
              status: { in: ['CHECKED_IN', 'CHECKED_OUT', 'LATE'] },
            },
          }),
        ]);

        return {
          brand: brand.name,
          attendance: scheduled > 0 ? Math.round((present / scheduled) * 1000) / 10 : 0,
          scheduled,
          present,
        };
      })
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/department-staffing?day=tomorrow
//
// Scheduled headcount per department. This is the honest version of the
// mockup's "AI Staffing Prediction" panel — real scheduled shifts, not a
// forecast, because there is no prediction engine.
router.get('/department-staffing', authenticateToken, async (req, res) => {
  try {
    const offset = req.query.day === 'today' ? 0 : 1;
    const { start, end } = dayBounds(offset);

    const grouped = await prisma.shift.groupBy({
      by: ['employeeId'],
      where: { ...outletScope(req), date: { gte: start, lt: end } },
    });

    const employeeIds = grouped.map((g) => g.employeeId);
    const employees = employeeIds.length
      ? await prisma.employee.groupBy({
          by: ['department'],
          where: { id: { in: employeeIds } },
          _count: true,
        })
      : [];

    const byDepartment = employees.map((d) => ({
      department: d.department,
      count: d._count,
    }));

    res.json({
      date: localDateKey(start),
      total: byDepartment.reduce((sum, d) => sum + d.count, 0),
      byDepartment,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
