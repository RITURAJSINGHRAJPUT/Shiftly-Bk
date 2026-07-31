import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import { outletInclude } from '../lib/scope.js';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const employee = await prisma.employee.findUnique({
      where: { email },
      include: outletInclude,
    });

    if (!employee) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, employee.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(employee);

    res.json({
      token,
      user: {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        role: employee.role,
        department: employee.department,
        outletId: employee.outletId,
        outlet: employee.outlet,
        avatar: employee.avatar,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.user.id },
      include: outletInclude,
    });

    if (!employee) return res.status(404).json({ error: 'User not found' });

    res.json({
      id: employee.id,
      name: employee.name,
      email: employee.email,
      role: employee.role,
      department: employee.department,
      outletId: employee.outletId,
      outlet: employee.outlet,
      avatar: employee.avatar,
      phone: employee.phone,
      skills: employee.skills,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
