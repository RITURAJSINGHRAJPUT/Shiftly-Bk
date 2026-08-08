const ROSTERABLE_ROLES = ['STAFF', 'HEAD_CHEF', 'MASTER_OF_HOUSE'];
const MANAGER_ROLES = ['HEAD_CHEF', 'MASTER_OF_HOUSE', 'HR', 'ADMIN', 'SUPER_ADMIN'];

function cleanSkills(skills) {
  if (!Array.isArray(skills)) return [];
  return [...new Set(skills.map(s => String(s).trim().toLowerCase()).filter(Boolean))];
}

export async function processTransferRequest(prisma, employeeId, body) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { outlet: { include: { brand: true } } },
  });
  if (!employee) throw new Error('Employee not found');
  if (!employee.isActive) throw new Error('Employee is not active');
  if (!ROSTERABLE_ROLES.includes(employee.role)) {
    throw new Error('Only operational staff can request transfers');
  }

  const existing = await prisma.transferRequest.findFirst({
    where: { employeeId, status: 'PENDING' },
  });
  if (existing) throw new Error('You already have a pending transfer request');

  const { type, targetOutletId, targetDepartment, targetSkills, reason } = body;

  if (!type || !['OUTLET', 'STATION'].includes(type)) {
    throw new Error('Transfer type must be OUTLET or STATION');
  }

  let data = {
    employeeId,
    type,
    fromOutletId: employee.outletId,
    fromDepartment: employee.department,
    fromSkills: employee.skills,
    reason: reason || null,
  };

  if (type === 'OUTLET') {
    if (!targetOutletId) throw new Error('Target outlet is required');
    if (targetOutletId === employee.outletId) {
      throw new Error('Target outlet must be different from current outlet');
    }
    const target = await prisma.outlet.findUnique({ where: { id: targetOutletId } });
    if (!target) throw new Error('Target outlet not found');
    if (!targetDepartment) throw new Error('Target department is required');

    data.targetOutletId = targetOutletId;
    data.targetDepartment = targetDepartment;
    data.targetSkills = targetDepartment === 'KITCHEN' ? cleanSkills(targetSkills) : [];
  } else {
    if (employee.department !== 'KITCHEN') {
      throw new Error('Station transfers are only for kitchen staff');
    }
    const cleaned = cleanSkills(targetSkills);
    if (cleaned.length === 0) throw new Error('Target stations are required');
    const current = [...employee.skills].sort().join(',');
    if (cleaned.sort().join(',') === current) {
      throw new Error('Target stations must differ from current stations');
    }
    data.targetOutletId = employee.outletId;
    data.targetDepartment = employee.department;
    data.targetSkills = cleaned;
  }

  const transfer = await prisma.transferRequest.create({
    data,
    include: {
      employee: { select: { id: true, name: true, department: true } },
      targetOutlet: { select: { id: true, name: true } },
    },
  });

  const approverWhere = {
    isActive: true,
    role: { in: MANAGER_ROLES },
    id: { not: employeeId },
  };

  if (type === 'OUTLET') {
    approverWhere.outletId = { in: [employee.outletId, targetOutletId].filter(Boolean) };
  } else {
    approverWhere.outletId = employee.outletId;
  }

  const approvers = await prisma.employee.findMany({
    where: approverWhere,
    select: { id: true },
  });

  const globalApprovers = await prisma.employee.findMany({
    where: { isActive: true, role: { in: ['HR', 'ADMIN', 'SUPER_ADMIN'] }, id: { not: employeeId } },
    select: { id: true },
  });

  const allApproverIds = [...new Set([...approvers.map(a => a.id), ...globalApprovers.map(a => a.id)])];

  if (allApproverIds.length > 0) {
    await prisma.notification.createMany({
      data: allApproverIds.map(id => ({
        employeeId: id,
        type: 'TRANSFER_REQUESTED',
        title: 'New Transfer Request',
        message: `${employee.name} has requested a ${type.toLowerCase()} transfer.`,
        actionUrl: '/transfers',
      })),
    });
  }

  return transfer;
}

export async function approveTransfer(prisma, transferId, approvedById) {
  const transfer = await prisma.transferRequest.findUnique({
    where: { id: transferId },
    include: { employee: true },
  });
  if (!transfer) throw new Error('Transfer request not found');
  if (transfer.status !== 'PENDING') throw new Error('Only pending transfers can be approved');

  return await prisma.$transaction(async (tx) => {
    const updated = await tx.transferRequest.update({
      where: { id: transferId },
      data: { status: 'APPROVED', approvedBy: approvedById },
      include: {
        employee: { select: { id: true, name: true } },
        targetOutlet: { select: { id: true, name: true } },
      },
    });

    const empUpdate = {};

    if (transfer.type === 'OUTLET') {
      empUpdate.outletId = transfer.targetOutletId;
      empUpdate.department = transfer.targetDepartment;
      empUpdate.skills = transfer.targetDepartment === 'KITCHEN' ? transfer.targetSkills : [];
    } else {
      empUpdate.skills = transfer.targetSkills;
    }

    await tx.employee.update({
      where: { id: transfer.employeeId },
      data: empUpdate,
    });

    let cancelledShifts = 0;
    if (transfer.type === 'OUTLET' && transfer.fromOutletId) {
      const result = await tx.shift.updateMany({
        where: {
          employeeId: transfer.employeeId,
          outletId: transfer.fromOutletId,
          status: 'ASSIGNED',
          date: { gte: new Date() },
        },
        data: { status: 'CANCELLED' },
      });
      cancelledShifts = result.count;
    }

    await tx.notification.create({
      data: {
        employeeId: transfer.employeeId,
        type: 'TRANSFER_APPROVED',
        title: 'Transfer Approved',
        message: transfer.type === 'OUTLET'
          ? `Your transfer to ${updated.targetOutlet?.name || 'new outlet'} has been approved.${cancelledShifts ? ` ${cancelledShifts} future shift(s) at your old outlet were cancelled.` : ''}`
          : `Your station transfer has been approved. Your stations have been updated.`,
        actionUrl: '/transfers',
      },
    });

    return { ...updated, cancelledShifts };
  });
}

export async function rejectTransfer(prisma, transferId, rejectedById, rejectionReason) {
  const transfer = await prisma.transferRequest.findUnique({ where: { id: transferId } });
  if (!transfer) throw new Error('Transfer request not found');
  if (transfer.status !== 'PENDING') throw new Error('Only pending transfers can be rejected');

  const updated = await prisma.transferRequest.update({
    where: { id: transferId },
    data: {
      status: 'REJECTED',
      approvedBy: rejectedById,
      rejectionReason: rejectionReason || null,
    },
    include: {
      employee: { select: { id: true, name: true } },
      targetOutlet: { select: { id: true, name: true } },
    },
  });

  await prisma.notification.create({
    data: {
      employeeId: transfer.employeeId,
      type: 'TRANSFER_REJECTED',
      title: 'Transfer Rejected',
      message: rejectionReason
        ? `Your transfer request was rejected: ${rejectionReason}`
        : 'Your transfer request has been rejected.',
      actionUrl: '/transfers',
    },
  });

  return updated;
}
