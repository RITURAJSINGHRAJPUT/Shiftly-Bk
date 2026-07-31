import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { authenticateToken, requireMinRole } from '../middleware/auth.js';
import { outletScope, outletInclude } from '../lib/scope.js';

const router = Router();

// GET /api/employees — list all employees (with filters)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { department, role, search, page = 1, limit = 50 } = req.query;

    // outletScope() resolves ?org/?brand/?outlet and pins non-global roles to
    // their own outlet, so it must be spread last.
    const where = { isActive: true, ...outletScope(req) };

    if (department) where.department = department;
    if (role) where.role = role;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        include: outletInclude,
        skip: (page - 1) * limit,
        take: parseInt(limit),
        orderBy: { name: 'asc' },
      }),
      prisma.employee.count({ where }),
    ]);

    // Remove passwords from response
    const sanitized = employees.map(({ password, ...emp }) => emp);

    res.json({ employees: sanitized, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/employees/:id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: {
        ...outletInclude,
        shifts: { orderBy: { date: 'desc' }, take: 20 },
        attendance: { orderBy: { date: 'desc' }, take: 30 },
        leaves: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });

    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const { password, ...sanitized } = employee;
    res.json(sanitized);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/employees — create employee
router.post('/', authenticateToken, requireMinRole('HR'), async (req, res) => {
  try {
    const { name, email, phone, role, department, outletId, skills, password } = req.body;

    if (!name || !department || !outletId) {
      return res.status(400).json({ error: 'name, department and outletId are required' });
    }

    const hashedPassword = await bcrypt.hash(password || 'shiftly123', 10);

    const employee = await prisma.employee.create({
      data: {
        name,
        email,
        phone,
        role: role || 'STAFF',
        department,
        outletId,
        skills: skills || [],
        password: hashedPassword,
      },
      include: outletInclude,
    });

    const { password: _, ...sanitized } = employee;
    res.status(201).json(sanitized);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/employees/:id
router.put('/:id', authenticateToken, requireMinRole('HR'), async (req, res) => {
  try {
    const { name, email, phone, role, department, outletId, skills, isActive } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (email !== undefined) data.email = email;
    if (phone !== undefined) data.phone = phone;
    if (role !== undefined) data.role = role;
    if (department !== undefined) data.department = department;
    if (outletId !== undefined) data.outletId = outletId;
    if (skills !== undefined) data.skills = skills;
    if (isActive !== undefined) data.isActive = isActive;

    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data,
      include: outletInclude,
    });

    const { password, ...sanitized } = employee;
    res.json(sanitized);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/employees/:id (soft delete)
router.delete('/:id', authenticateToken, requireMinRole('ADMIN'), async (req, res) => {
  try {
    await prisma.employee.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ message: 'Employee deactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/employees/stats/overview
router.get('/stats/overview', authenticateToken, async (req, res) => {
  try {
    const where = outletScope(req);

    const [total, active, byDepartment, byOutlet] = await Promise.all([
      prisma.employee.count({ where: { ...where } }),
      prisma.employee.count({ where: { ...where, isActive: true } }),
      prisma.employee.groupBy({ by: ['department'], _count: true, where: { ...where, isActive: true } }),
      prisma.employee.groupBy({ by: ['outletId'], _count: true, where: { ...where, isActive: true } }),
    ]);

    res.json({ total, active, byDepartment, byOutlet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
