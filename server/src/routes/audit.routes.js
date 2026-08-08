import { Router } from 'express';
import prisma from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { can } from '../lib/capabilities.js';

const router = Router();

router.get('/', authenticateToken, can('AUDIT_VIEW'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const where = {};

    if (req.query.action) {
      where.action = req.query.action;
    }
    if (req.query.actor) {
      where.actorName = { contains: req.query.actor, mode: 'insensitive' };
    }
    if (req.query.entity) {
      where.entity = req.query.entity;
    }
    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt.gte = new Date(req.query.from);
      if (req.query.to) {
        const to = new Date(req.query.to);
        to.setHours(23, 59, 59, 999);
        where.createdAt.lte = to;
      }
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ logs, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Audit logs fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

export default router;
