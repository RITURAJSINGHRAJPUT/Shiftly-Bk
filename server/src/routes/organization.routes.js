import { Router } from 'express';
import prisma from '../db.js';
import { authenticateToken, requireMinRole } from '../middleware/auth.js';

const router = Router();

// GET /api/organizations
router.get('/', authenticateToken, async (req, res) => {
  try {
    const organizations = await prisma.organization.findMany({
      where: { isActive: true },
      include: {
        brands: {
          where: { isActive: true },
          select: { id: true, name: true, _count: { select: { outlets: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });
    res.json(organizations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/organizations/:id
router.put('/:id', authenticateToken, requireMinRole('ADMIN'), async (req, res) => {
  try {
    const { name, isActive } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (isActive !== undefined) data.isActive = isActive;

    const organization = await prisma.organization.update({
      where: { id: req.params.id },
      data,
    });
    res.json(organization);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
