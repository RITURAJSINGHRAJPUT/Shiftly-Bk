import { Router } from 'express';
import prisma from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { can } from '../lib/capabilities.js';
import { processLeaveRequest, approveLeave, rejectLeave } from '../engine/leaveManager.js';
import { requestEmergencyLeave, acceptEmergencyCover, autoAssignEmergency } from '../engine/emergencyLeave.js';
import { employeeScope, hasGlobalScope } from '../lib/scope.js';
import { logAudit } from '../lib/audit.js';

const router = Router();

/** Who, besides HR/ADMIN/SUPER_ADMIN, owns approval for each department. */
const DEPARTMENT_APPROVERS = {
  KITCHEN: 'HEAD_CHEF',
  SERVICE: 'MASTER_OF_HOUSE',
  HOUSEKEEPING: 'MASTER_OF_HOUSE',
};

/**
 * HR/ADMIN/SUPER_ADMIN may act on any leave. An OUTLET_MANAGER may act on any
 * department's leave, but only at their own outlet. A department manager
 * (HEAD_CHEF, MASTER_OF_HOUSE) may only act on their own outlet's leaves, and
 * only for the department they own per DEPARTMENT_APPROVERS. Returns an error
 * string, or null when the action is allowed.
 */
function leaveApprovalDenied(req, leave) {
  if (hasGlobalScope(req.user)) return null;
  if (leave.employee.outletId !== req.user.outletId) {
    return 'You can only act on leave requests for your own outlet';
  }
  if (req.user.role === 'OUTLET_MANAGER') return null;
  if (DEPARTMENT_APPROVERS[leave.employee.department] !== req.user.role) {
    return 'You can only approve leave requests for your own department';
  }
  return null;
}

/** Employee summary shape reused across this router's responses. */
const leaveEmployeeSelect = {
  select: {
    id: true,
    name: true,
    department: true,
    skills: true,
    outletId: true,
    outlet: { select: { name: true, brand: { select: { name: true } } } },
  },
};

// GET /api/leaves — list leave requests
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, employee, type, startDate, endDate } = req.query;
    const where = { ...employeeScope(req) };

    if (status) where.status = status;
    if (type) where.type = type;

    if (startDate || endDate) {
      where.endDate = startDate ? { gte: new Date(startDate) } : undefined;
      where.startDate = endDate ? { lte: new Date(endDate) } : undefined;
    }

    // Staff can only see their own leaves
    if (req.user.role === 'STAFF') {
      where.employeeId = req.user.id;
    } else if (employee) {
      where.employeeId = employee;
    }

    const leaves = await prisma.leave.findMany({
      where,
      include: { employee: leaveEmployeeSelect },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json(leaves);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leaves — request leave
router.post('/', authenticateToken, async (req, res) => {
  try {
    const leave = await processLeaveRequest(prisma, req.user.id, req.body);
    res.status(201).json(leave);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/leaves/:id/approve
router.post('/:id/approve', authenticateToken, can('LEAVE_APPROVE'), async (req, res) => {
  try {
    const leave = await prisma.leave.findUnique({
      where: { id: req.params.id },
      select: { employee: { select: { outletId: true, department: true } } },
    });
    if (!leave) return res.status(404).json({ error: 'Leave not found' });
    const denied = leaveApprovalDenied(req, leave);
    if (denied) return res.status(403).json({ error: denied });

    const result = await approveLeave(prisma, req.params.id, req.user.id);

    logAudit({ action: 'LEAVE_APPROVE', entity: 'Leave', entityId: req.params.id, actor: req.user, details: { employeeName: result.employee?.name } });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/leaves/:id/reject
router.post('/:id/reject', authenticateToken, can('LEAVE_REJECT'), async (req, res) => {
  try {
    const leave = await prisma.leave.findUnique({
      where: { id: req.params.id },
      select: { employee: { select: { outletId: true, department: true } } },
    });
    if (!leave) return res.status(404).json({ error: 'Leave not found' });
    const denied = leaveApprovalDenied(req, leave);
    if (denied) return res.status(403).json({ error: denied });

    const result = await rejectLeave(prisma, req.params.id, req.user.id, req.body.reason);

    logAudit({ action: 'LEAVE_REJECT', entity: 'Leave', entityId: req.params.id, actor: req.user, details: { employeeName: result.employee?.name, reason: req.body.reason } });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/leaves/emergency — request emergency leave
router.post('/emergency', authenticateToken, async (req, res) => {
  try {
    const result = await requestEmergencyLeave(prisma, req.user.id, req.body.reason);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/leaves/emergency/:leaveId/accept — volunteer accepts cover
router.post('/emergency/:leaveId/accept', authenticateToken, async (req, res) => {
  try {
    const result = await acceptEmergencyCover(prisma, req.user.id, req.params.leaveId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/leaves/emergency/:leaveId/auto-assign — called by timer/admin
router.post('/emergency/:leaveId/auto-assign', authenticateToken, can('LEAVE_AUTO_ASSIGN'), async (req, res) => {
  try {
    const leave = await prisma.leave.findUnique({
      where: { id: req.params.leaveId },
      select: { employee: { select: { outletId: true, department: true } } },
    });
    if (!leave) return res.status(404).json({ error: 'Leave not found' });
    const denied = leaveApprovalDenied(req, leave);
    if (denied) return res.status(403).json({ error: denied });

    const result = await autoAssignEmergency(prisma, req.params.leaveId);
    if (!result) return res.status(404).json({ error: 'Already handled or no eligible employees' });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/leaves/emergency/pending — get pending emergency leaves
//
// Scoped: this list drives the "volunteer to cover" action, so it must only
// show requests the caller could actually cover. It previously returned every
// outlet's emergencies to every authenticated user.
router.get('/emergency/pending', authenticateToken, async (req, res) => {
  try {
    const leaves = await prisma.leave.findMany({
      where: {
        ...employeeScope(req),
        isEmergency: true,
        status: 'COVERAGE_PENDING',
      },
      include: { employee: leaveEmployeeSelect },
      orderBy: { createdAt: 'desc' },
    });
    res.json(leaves);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leaves/stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const scope = employeeScope(req);
    const [pending, approved, emergency, total] = await Promise.all([
      prisma.leave.count({ where: { ...scope, status: 'PENDING' } }),
      prisma.leave.count({ where: { ...scope, status: 'APPROVED' } }),
      prisma.leave.count({
        where: { ...scope, isEmergency: true, status: 'COVERAGE_PENDING' },
      }),
      prisma.leave.count({ where: scope }),
    ]);
    res.json({ pending, approved, emergency, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
