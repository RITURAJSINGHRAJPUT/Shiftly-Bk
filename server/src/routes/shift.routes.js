import { Router } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import prisma from '../db.js';
import { authenticateToken, requireMinRole } from '../middleware/auth.js';
import { autoAllocateShifts } from '../engine/shiftAllocator.js';
import { parseCSVShiftPattern, applyCSVPattern } from '../engine/csvShiftParser.js';
import { outletScope } from '../lib/scope.js';
import { localDateRange, startOfLocalDay, localDateKey } from '../lib/dates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// POST /api/shifts/import-csv-pattern
// Reads the CSV, parses each outlet's Mon-Sun staffing matrix, and creates
// Shift rows that exactly match the spreadsheet's per-day assignments.
router.post('/import-csv-pattern', authenticateToken, requireMinRole('HEAD_CHEF'), async (req, res) => {
  try {
    const { outletId, startDate } = req.body;
    const targetOutletId = outletId || req.user.outletId;

    // Resolve the outlet name for CSV matching
    const outlet = await prisma.outlet.findUnique({ where: { id: targetOutletId } });
    if (!outlet) return res.status(404).json({ error: 'Outlet not found' });

    // Parse CSV
    const csvPath = join(__dirname, '../../../assets/Shiftly Shift Shift - Sheet1.csv');
    const csvData = parseCSVShiftPattern(csvPath);
    const outletData = csvData[outlet.name];

    if (!outletData || outletData.assignments.length === 0) {
      return res.json({
        created: 0,
        skipped: 0,
        total: 0,
        outlet: { id: outlet.id, name: outlet.name },
        message: `No shift assignments found in CSV for "${outlet.name}".`,
      });
    }

    // Calculate the Monday of the target week
    const targetDate = startDate ? startOfLocalDay(startDate) : new Date();
    const dayOfWeek = targetDate.getDay(); // 0=Sun, 1=Mon, …
    const weekMonday = new Date(targetDate);
    weekMonday.setDate(targetDate.getDate() - ((dayOfWeek + 6) % 7));
    weekMonday.setHours(0, 0, 0, 0);

    // Clear existing shifts for this outlet in the target week before importing
    const weekSunday = new Date(weekMonday);
    weekSunday.setDate(weekMonday.getDate() + 6);
    await prisma.shift.deleteMany({
      where: {
        outletId: targetOutletId,
        date: localDateRange(
          localDateKey(weekMonday),
          localDateKey(weekSunday)
        ),
      },
    });

    // Apply the pattern
    const result = await applyCSVPattern(prisma, targetOutletId, outlet.name, weekMonday, outletData);

    res.json({
      ...result,
      outlet: { id: outlet.id, name: outlet.name },
      weekStart: localDateKey(weekMonday),
    });
  } catch (err) {
    console.error('CSV import error:', err);
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
