import { Router } from 'express';
import prisma from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { can } from '../lib/capabilities.js';

const router = Router();

/** Every restaurant always has one of each. */
const REQUIRED_MANAGER_ROLES = ['MASTER_OF_HOUSE', 'HEAD_CHEF'];

// GET /api/outlets — optionally filtered by ?org= or ?brand=
router.get('/', authenticateToken, async (req, res) => {
  try {
    const where = { isActive: true };
    if (req.query.brand) where.brandId = req.query.brand;
    if (req.query.org) where.brand = { organizationId: req.query.org };

    const outlets = await prisma.outlet.findMany({
      where,
      include: {
        brand: {
          // `stations` comes along because Shift Master's grid draws one row per
          // station and the two brands do not share a list — without it the page
          // would need a second round trip just to know its own row headings.
          select: {
            id: true,
            name: true,
            stations: true,
            organization: { select: { id: true, name: true } },
          },
        },
        _count: { select: { employees: true } },
        // Every restaurant is expected to have both of these, so they are
        // returned alongside the outlet for the client to flag any gap.
        employees: {
          where: { isActive: true, role: { in: REQUIRED_MANAGER_ROLES } },
          select: { id: true, name: true, email: true, role: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const withCoverage = outlets.map(({ employees, ...outlet }) => {
      const managers = Object.fromEntries(
        REQUIRED_MANAGER_ROLES.map((role) => [role, employees.find((e) => e.role === role) || null])
      );
      return {
        ...outlet,
        managers,
        missingManagers: REQUIRED_MANAGER_ROLES.filter((role) => !managers[role]),
      };
    });

    res.json(withCoverage);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/outlets
router.post('/', authenticateToken, can('OUTLET_CREATE'), async (req, res) => {
  try {
    const { name, brandId, address, latitude, longitude, radius } = req.body;
    if (!name || !brandId) {
      return res.status(400).json({ error: 'name and brandId are required' });
    }

    const outlet = await prisma.outlet.create({
      data: {
        name,
        brandId,
        address,
        ...(latitude !== undefined && { latitude: parseFloat(latitude) }),
        ...(longitude !== undefined && { longitude: parseFloat(longitude) }),
        ...(radius !== undefined && { radius: parseInt(radius) }),
      },
      include: { brand: { select: { id: true, name: true } } },
    });
    res.status(201).json(outlet);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'An outlet with that name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/outlets/:id
//
// Guarded at ADMIN: this endpoint moves the geofence, so anyone who can call it
// can defeat attendance validation. It previously shipped with no role check.
router.put('/:id', authenticateToken, can('OUTLET_EDIT'), async (req, res) => {
  try {
    const { name, brandId, address, latitude, longitude, radius, isActive } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (brandId !== undefined) data.brandId = brandId;
    if (address !== undefined) data.address = address;
    if (isActive !== undefined) data.isActive = isActive;

    if (latitude !== undefined) {
      const lat = parseFloat(latitude);
      if (Number.isNaN(lat) || lat < -90 || lat > 90) {
        return res.status(400).json({ error: 'latitude must be between -90 and 90' });
      }
      data.latitude = lat;
    }
    if (longitude !== undefined) {
      const lng = parseFloat(longitude);
      if (Number.isNaN(lng) || lng < -180 || lng > 180) {
        return res.status(400).json({ error: 'longitude must be between -180 and 180' });
      }
      data.longitude = lng;
    }
    if (radius !== undefined) {
      const r = parseInt(radius);
      if (Number.isNaN(r) || r < 10 || r > 10000) {
        return res.status(400).json({ error: 'radius must be between 10 and 10000 metres' });
      }
      data.radius = r;
    }

    const outlet = await prisma.outlet.update({
      where: { id: req.params.id },
      data,
      include: { brand: { select: { id: true, name: true } } },
    });
    res.json(outlet);
  } catch (err) {
    // Outlet.name is unique. POST already mapped this to a readable 400; without
    // the same here, renaming onto an existing name surfaced as a bare 500 and
    // read like a server fault rather than a name clash.
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'An outlet with that name already exists' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Outlet not found' });
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;
