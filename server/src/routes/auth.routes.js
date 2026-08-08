import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { generateToken, authenticateToken, authenticateResettable } from '../middleware/auth.js';
import { outletInclude } from '../lib/scope.js';
import { passwordProblem } from '../lib/passwords.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { logAudit } from '../lib/audit.js';

const router = Router();

/** One message for every failure, so responses never disclose which accounts exist. */
const INVALID = 'Invalid email or password';

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
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
      logAudit({ action: 'LOGIN_FAILED', entity: 'Auth', details: { email } });
      return res.status(401).json({ error: INVALID });
    }

    const validPassword = await bcrypt.compare(password, employee.password);
    if (!validPassword) {
      logAudit({ action: 'LOGIN_FAILED', entity: 'Auth', actor: employee, details: { email } });
      return res.status(401).json({ error: INVALID });
    }

    // Deactivating someone did not lock them out: DELETE /api/employees only
    // sets isActive:false, so every "deleted" account kept a working login and a
    // seven-day token. Checked after the password compare and with the same
    // message, so this does not become a way to enumerate accounts.
    if (!employee.isActive) {
      return res.status(401).json({ error: INVALID });
    }

    const token = generateToken(employee, { passwordReset: employee.mustChangePassword });

    logAudit({ action: 'LOGIN', entity: 'Auth', entityId: employee.id, actor: employee });

    res.json({
      token,
      mustChangePassword: employee.mustChangePassword,
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

/**
 * POST /api/auth/change-password
 *
 * Serves both the forced first change and anyone changing theirs voluntarily —
 * one path, so the strength rule and the flag clearing cannot diverge. Takes a
 * resettable token, since an account with a temporary password holds nothing
 * else.
 */
router.post('/change-password', loginLimiter, authenticateResettable, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }

    const employee = await prisma.employee.findUnique({ where: { id: req.user.id } });
    if (!employee || !employee.isActive) return res.status(401).json({ error: INVALID });

    if (!(await bcrypt.compare(currentPassword, employee.password))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const problem = passwordProblem(newPassword, employee.email);
    if (problem) return res.status(400).json({ error: problem });

    if (await bcrypt.compare(newPassword, employee.password)) {
      return res.status(400).json({ error: 'New password must be different from the current one' });
    }

    const updated = await prisma.employee.update({
      where: { id: employee.id },
      data: {
        password: await bcrypt.hash(newPassword, 10),
        mustChangePassword: false,
      },
      include: outletInclude,
    });

    logAudit({ action: 'PASSWORD_CHANGE', entity: 'Auth', entityId: employee.id, actor: employee });

    res.json({ token: generateToken(updated), mustChangePassword: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
//
// Resettable, so the set-password screen can greet the account by name. It
// returns no operational data, only who is signed in.
router.get('/me', authenticateResettable, async (req, res) => {
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
      // So a reload part-way through setting a password lands back on the same
      // screen instead of an app that 403s on every request.
      mustChangePassword: employee.mustChangePassword,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
