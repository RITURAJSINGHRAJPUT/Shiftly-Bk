/**
 * Leave Manager Engine
 * Handles leave requests and auto-reallocation of shifts
 */

/**
 * Process a regular leave request
 * - Validates dates
 * - Checks leave balance
 * - If approved, triggers shift reallocation
 */
export async function processLeaveRequest(prisma, employeeId, leaveData) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { outlet: true },
  });

  if (!employee) throw new Error('Employee not found');

  const { type, startDate, endDate, reason } = leaveData;

  // Validate dates
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (start > end) throw new Error('Start date must be before end date');
  if (start < new Date()) throw new Error('Cannot request leave in the past');

  // Check for overlapping leaves
  const overlapping = await prisma.leave.findFirst({
    where: {
      employeeId,
      status: { in: ['PENDING', 'APPROVED'] },
      OR: [
        { startDate: { lte: end }, endDate: { gte: start } },
      ],
    },
  });

  if (overlapping) throw new Error('Overlapping leave request exists');

  const isSingleDay = start.toDateString() === end.toDateString();
  const dayOfWeek = start.getDay();
  let autoApprove = isSingleDay && dayOfWeek >= 1 && dayOfWeek <= 4;

  if (autoApprove && employee.outletId && employee.department) {
    const colleagueOnLeave = await prisma.leave.findFirst({
      where: {
        status: 'APPROVED',
        startDate: { lte: end },
        endDate: { gte: start },
        employee: {
          outletId: employee.outletId,
          department: employee.department,
          id: { not: employeeId },
        },
      },
    });
    if (colleagueOnLeave) autoApprove = false;
  }

  // Auto-approval creates the leave directly, bypassing approveLeave() and
  // the shift-reallocation/replacement search it runs. If the employee is
  // already rostered that day, skipping straight to APPROVED would leave the
  // shift assigned to someone now on leave, with no replacement found and no
  // one notified. Fall back to PENDING so a manager reviews it through the
  // normal approve flow instead, which does run reallocation.
  if (autoApprove) {
    const scheduledShift = await prisma.shift.findFirst({
      where: {
        employeeId,
        status: 'ASSIGNED',
        date: { gte: start, lte: end },
      },
    });
    if (scheduledShift) autoApprove = false;
  }

  const leave = await prisma.leave.create({
    data: {
      employeeId,
      type,
      startDate: start,
      endDate: end,
      reason,
      status: autoApprove ? 'APPROVED' : 'PENDING',
      isEmergency: false,
    },
  });

  return leave;
}

/**
 * Approve a leave and trigger shift reallocation
 */
export async function approveLeave(prisma, leaveId, approvedBy) {
  const leave = await prisma.leave.findUnique({
    where: { id: leaveId },
    include: { employee: true },
  });

  if (!leave) throw new Error('Leave not found');
  if (leave.status !== 'PENDING' && leave.status !== 'COVERAGE_PENDING') {
    throw new Error('Leave cannot be approved in current status');
  }

  // Find shifts that need reallocation
  const affectedShifts = await prisma.shift.findMany({
    where: {
      employeeId: leave.employeeId,
      date: {
        gte: leave.startDate,
        lte: leave.endDate,
      },
      status: 'ASSIGNED',
    },
  });

  // Auto-reallocate each affected shift
  const reallocations = [];
  for (const shift of affectedShifts) {
    const replacement = await findBestReplacement(prisma, shift, leave.employeeId);
    if (replacement) {
      await prisma.shift.update({
        where: { id: shift.id },
        data: {
          employeeId: replacement.id,
          status: 'SWAPPED',
        },
      });

      // Notify the replacement employee
      await prisma.notification.create({
        data: {
          employeeId: replacement.id,
          type: 'SHIFT_ASSIGNED',
          title: 'Shift Reassigned to You',
          message: `You've been assigned a ${shift.section || 'general'} shift on ${new Date(shift.date).toLocaleDateString()} (${shift.startTime}-${shift.endTime}) due to ${leave.employee.name}'s leave.`,
        },
      });

      reallocations.push({ shift, replacement });
    }
  }

  // Update leave status
  const updatedLeave = await prisma.leave.update({
    where: { id: leaveId },
    data: {
      status: 'APPROVED',
      approvedBy,
    },
  });

  // `employee` at the top level (not just nested under `leave`) so callers —
  // namely the route's audit-log call, which reads `result.employee?.name` —
  // get it without needing a second fetch; `updatedLeave` itself has no
  // `include` and would otherwise carry no employee data.
  return { leave: updatedLeave, employee: leave.employee, reallocations };
}

/**
 * Find the best replacement for a shift
 */
async function findBestReplacement(prisma, shift, excludeEmployeeId) {
  const employees = await prisma.employee.findMany({
    where: {
      outletId: shift.outletId,
      isActive: true,
      id: { not: excludeEmployeeId },
    },
    include: {
      shifts: {
        where: {
          date: shift.date,
        },
      },
      leaves: {
        where: {
          status: 'APPROVED',
          startDate: { lte: shift.date },
          endDate: { gte: shift.date },
        },
      },
    },
  });

  // Filter out employees who are busy or on leave
  const available = employees.filter(emp => {
    if (emp.leaves.length > 0) return false;
    const hasConflict = emp.shifts.some(s => {
      const toMin = (t) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + (m || 0);
      };
      return toMin(s.startTime) < toMin(shift.endTime) &&
             toMin(shift.startTime) < toMin(s.endTime);
    });
    return !hasConflict;
  });

  if (available.length === 0) return null;

  // Score by workload (fewer shifts this week = better)
  const weekStart = new Date(shift.date);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const withWorkload = await Promise.all(
    available.map(async (emp) => {
      const weekShifts = await prisma.shift.count({
        where: {
          employeeId: emp.id,
          date: { gte: weekStart, lte: weekEnd },
        },
      });
      return { employee: emp, weekShifts };
    })
  );

  // Sort by workload (lightest first), with skill match bonus
  withWorkload.sort((a, b) => {
    const aSkill = shift.section && a.employee.skills.includes(shift.section.toLowerCase()) ? -10 : 0;
    const bSkill = shift.section && b.employee.skills.includes(shift.section.toLowerCase()) ? -10 : 0;
    return (a.weekShifts + aSkill) - (b.weekShifts + bSkill);
  });

  return withWorkload[0]?.employee || null;
}

/**
 * Reject a leave request
 */
export async function rejectLeave(prisma, leaveId, approvedBy, reason) {
  const leave = await prisma.leave.update({
    where: { id: leaveId },
    data: {
      status: 'REJECTED',
      approvedBy,
    },
    include: { employee: true },
  });

  await prisma.notification.create({
    data: {
      employeeId: leave.employeeId,
      type: 'LEAVE_REJECTED',
      title: 'Leave Request Rejected',
      message: reason || 'Your leave request has been rejected.',
    },
  });

  // `employee` at the top level too, matching approveLeave()'s shape — the
  // route's audit-log call reads `result.employee?.name`.
  return { leave, employee: leave.employee };
}
