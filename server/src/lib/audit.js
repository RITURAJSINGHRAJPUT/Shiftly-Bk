import prisma from '../db.js';

export async function logAudit({ action, entity, entityId, actor, details }) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entity: entity || undefined,
        entityId: entityId || undefined,
        actorId: actor?.id || undefined,
        actorName: actor?.name || undefined,
        actorRole: actor?.role || undefined,
        details: details || undefined,
      },
    });
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
}
