import { Router } from 'express';
import prisma from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { can } from '../lib/capabilities.js';

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

/**
 * POST /api/organizations
 *
 * This router had only GET and PUT, which made an empty database unusable:
 * `Brand.organizationId` is required, so with no organisation you cannot create
 * a brand, therefore no outlet, therefore no employee — every account needs one.
 * The only code that had ever created one was the demo seeder, which is gated
 * and destructive, so a fresh deployment looked healthy and could do nothing.
 */
router.post('/', authenticateToken, can('ORGANIZATION_CREATE'), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const organization = await prisma.organization.create({
      data: { name: String(name).trim() },
    });
    res.status(201).json(organization);
  } catch (err) {
    // Organization.name is unique. Mapped here as the brand and outlet POSTs
    // already do, so a duplicate reads as a name clash rather than a server fault.
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'An organization with that name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/organizations/:id
router.put('/:id', authenticateToken, can('ORGANIZATION_EDIT'), async (req, res) => {
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
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'An organization with that name already exists' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Organization not found' });
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;
