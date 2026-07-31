import { Router } from 'express';
import prisma from '../db.js';
import { authenticateToken, requireMinRole } from '../middleware/auth.js';

const router = Router();

// GET /api/brands — optionally filtered by ?org=
router.get('/', authenticateToken, async (req, res) => {
  try {
    const where = { isActive: true };
    if (req.query.org) where.organizationId = req.query.org;

    const brands = await prisma.brand.findMany({
      where,
      include: {
        organization: { select: { id: true, name: true } },
        _count: { select: { outlets: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json(brands);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brands
router.post('/', authenticateToken, requireMinRole('ADMIN'), async (req, res) => {
  try {
    const { name, organizationId } = req.body;
    if (!name || !organizationId) {
      return res.status(400).json({ error: 'name and organizationId are required' });
    }

    const brand = await prisma.brand.create({
      data: { name, organizationId },
      include: { organization: { select: { id: true, name: true } } },
    });
    res.status(201).json(brand);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'A brand with that name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/brands/:id
router.put('/:id', authenticateToken, requireMinRole('ADMIN'), async (req, res) => {
  try {
    const { name, organizationId, isActive } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (organizationId !== undefined) data.organizationId = organizationId;
    if (isActive !== undefined) data.isActive = isActive;

    const brand = await prisma.brand.update({
      where: { id: req.params.id },
      data,
      include: { organization: { select: { id: true, name: true } } },
    });
    res.json(brand);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
