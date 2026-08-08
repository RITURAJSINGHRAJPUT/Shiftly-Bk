import { Router } from 'express';
import prisma from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { can } from '../lib/capabilities.js';
import { hasGlobalScope, GLOBAL_SCOPE_ROLES } from '../lib/scope.js';
import { processTransferRequest, approveTransfer, rejectTransfer } from '../engine/transferManager.js';
import { logAudit } from '../lib/audit.js';

const router = Router();

const transferInclude = {
  employee: {
    select: {
      id: true, name: true, department: true, skills: true,
      outlet: { select: { id: true, name: true, brand: { select: { id: true, name: true } } } },
    },
  },
  targetOutlet: {
    select: { id: true, name: true, brand: { select: { id: true, name: true, stations: true } } },
  },
};

router.get('/', authenticateToken, async (req, res) => {
  try {
    const where = {};

    if (req.user.role === 'STAFF') {
      where.employeeId = req.user.id;
    } else if (!hasGlobalScope(req.user)) {
      const oid = req.user.outletId;
      if (oid) {
        where.OR = [
          { fromOutletId: oid },
          { targetOutletId: oid },
          { employeeId: req.user.id },
        ];
      } else {
        where.employeeId = req.user.id;
      }
    } else {
      if (req.query.outlet) {
        where.OR = [
          { fromOutletId: req.query.outlet },
          { targetOutletId: req.query.outlet },
        ];
      }
    }

    if (req.query.status) where.status = req.query.status;
    if (req.query.type) where.type = req.query.type;

    const transfers = await prisma.transferRequest.findMany({
      where,
      include: transferInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json(transfers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const transfer = await processTransferRequest(prisma, req.user.id, req.body);

    logAudit({ action: 'TRANSFER_REQUEST', entity: 'TransferRequest', entityId: transfer.id, actor: req.user, details: { type: req.body.type } });

    res.status(201).json(transfer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/approve', authenticateToken, can('TRANSFER_APPROVE'), async (req, res) => {
  try {
    const result = await approveTransfer(prisma, req.params.id, req.user.id);

    logAudit({ action: 'TRANSFER_APPROVE', entity: 'TransferRequest', entityId: req.params.id, actor: req.user, details: { employeeName: result.employee?.name, type: result.type } });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/reject', authenticateToken, can('TRANSFER_REJECT'), async (req, res) => {
  try {
    const result = await rejectTransfer(prisma, req.params.id, req.user.id, req.body.reason);

    logAudit({ action: 'TRANSFER_REJECT', entity: 'TransferRequest', entityId: req.params.id, actor: req.user, details: { employeeName: result.employee?.name, reason: req.body.reason } });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const transfer = await prisma.transferRequest.findUnique({ where: { id: req.params.id } });
    if (!transfer) return res.status(404).json({ error: 'Transfer request not found' });
    if (transfer.employeeId !== req.user.id) {
      return res.status(403).json({ error: 'You can only cancel your own transfer requests' });
    }
    if (transfer.status !== 'PENDING') {
      return res.status(400).json({ error: 'Only pending transfers can be cancelled' });
    }

    const updated = await prisma.transferRequest.update({
      where: { id: req.params.id },
      data: { status: 'CANCELLED' },
      include: transferInclude,
    });

    logAudit({ action: 'TRANSFER_CANCEL', entity: 'TransferRequest', entityId: req.params.id, actor: req.user });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
