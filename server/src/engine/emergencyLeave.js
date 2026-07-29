/**
 * Emergency Leave Engine
 * Handles the 2-hour pre-shift, 30-minute volunteer window workflow
 */

const EMERGENCY_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const MIN_HOURS_BEFORE_SHIFT = 2;

/**
 * Process an emergency leave request
 * 1. Validate it's ≥2 hours before shift
 * 2. Create emergency leave with COVERAGE_PENDING status
 * 3. Broadcast notification to eligible team members
 * 4. Set 30-minute expiration
 */
export async function requestEmergencyLeave(prisma, employeeId, reason) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { venue: true },
  });

  if (!employee) throw new Error('Employee not found');

  // Find today's shift for this employee
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayShift = await prisma.shift.findFirst({
    where: {
      employeeId,
      date: today,
      status: 'ASSIGNED',
    },
  });

  if (!todayShift) throw new Error('No shift found for today');

  // Validate: must be ≥2 hours before shift start
  const now = new Date();
  const [sh, sm] = todayShift.startTime.split(':').map(Number);
  const shiftStart = new Date(today);
  shiftStart.setHours(sh, sm, 0, 0);

  const hoursUntilShift = (shiftStart - now) / (1000 * 60 * 60);

  if (hoursUntilShift < MIN_HOURS_BEFORE_SHIFT) {
    throw new Error(
      `Emergency leave must be requested at least ${MIN_HOURS_BEFORE_SHIFT} hours before shift start. ` +
      `Your shift starts at ${todayShift.startTime} and it's currently ${now.toLocaleTimeString()}.`
    );
  }

  // Create emergency leave
  const expiresAt = new Date(now.getTime() + EMERGENCY_WINDOW_MS);

  const leave = await prisma.leave.create({
    data: {
      employeeId,
      type: 'EMERGENCY',
      startDate: today,
      endDate: today,
      reason: reason || 'Emergency leave',
      status: 'COVERAGE_PENDING',
      isEmergency: true,
      expiresAt,
    },
  });

  // Find eligible team members to cover
  const eligibleEmployees = await prisma.employee.findMany({
    where: {
      venueId: employee.venueId,
      department: employee.department,
      isActive: true,
      id: { not: employeeId },
    },
    include: {
      shifts: {
        where: { date: today },
      },
      leaves: {
        where: {
          status: 'APPROVED',
          startDate: { lte: today },
          endDate: { gte: today },
        },
      },
    },
  });

  // Filter to only those who are free during this shift
  const available = eligibleEmployees.filter(emp => {
    if (emp.leaves.length > 0) return false;
    const hasConflict = emp.shifts.some(s => {
      const toMin = (t) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + (m || 0);
      };
      return toMin(s.startTime) < toMin(todayShift.endTime) &&
             toMin(todayShift.startTime) < toMin(s.endTime);
    });
    return !hasConflict;
  });

  // Broadcast emergency cover request to all eligible
  const notifications = await Promise.all(
    available.map(emp =>
      prisma.notification.create({
        data: {
          employeeId: emp.id,
          type: 'EMERGENCY_COVER_REQUEST',
          title: '🚨 Emergency Shift Cover Needed!',
          message: `${employee.name} needs emergency cover for ${todayShift.section || 'their'} shift (${todayShift.startTime}-${todayShift.endTime}) today. Accept within 30 minutes!`,
          actionData: JSON.stringify({
            leaveId: leave.id,
            shiftId: todayShift.id,
            employeeId: employee.id,
          }),
          expiresAt,
        },
      })
    )
  );

  return {
    leave,
    shift: todayShift,
    notifiedCount: notifications.length,
    expiresAt,
    eligibleEmployees: available.map(e => ({ id: e.id, name: e.name })),
  };
}

/**
 * Accept an emergency cover request
 */
export async function acceptEmergencyCover(prisma, volunteerId, leaveId) {
  const leave = await prisma.leave.findUnique({
    where: { id: leaveId },
    include: { employee: true },
  });

  if (!leave) throw new Error('Leave not found');
  if (leave.status !== 'COVERAGE_PENDING') {
    throw new Error('This emergency request has already been handled');
  }

  // Check if still within 30-min window
  if (leave.expiresAt && new Date() > leave.expiresAt) {
    throw new Error('The 30-minute acceptance window has expired');
  }

  // Find the shift to cover
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const shift = await prisma.shift.findFirst({
    where: {
      employeeId: leave.employeeId,
      date: today,
      status: 'ASSIGNED',
    },
  });

  if (!shift) throw new Error('Shift not found');

  // Reassign the shift to volunteer
  await prisma.shift.update({
    where: { id: shift.id },
    data: {
      employeeId: volunteerId,
      status: 'SWAPPED',
    },
  });

  // Approve the emergency leave
  await prisma.leave.update({
    where: { id: leaveId },
    data: {
      status: 'APPROVED',
      coveredById: volunteerId,
    },
  });

  const volunteer = await prisma.employee.findUnique({ where: { id: volunteerId } });

  // Notify original employee
  await prisma.notification.create({
    data: {
      employeeId: leave.employeeId,
      type: 'EMERGENCY_COVER_ACCEPTED',
      title: '✅ Emergency Leave Approved',
      message: `${volunteer.name} has volunteered to cover your shift. Your emergency leave is approved.`,
    },
  });

  // Notify volunteer
  await prisma.notification.create({
    data: {
      employeeId: volunteerId,
      type: 'SHIFT_ASSIGNED',
      title: 'Shift Coverage Confirmed',
      message: `You are now covering ${leave.employee.name}'s ${shift.section || ''} shift (${shift.startTime}-${shift.endTime}) today.`,
    },
  });

  // Expire other notifications for this leave
  await prisma.notification.updateMany({
    where: {
      type: 'EMERGENCY_COVER_REQUEST',
      actionData: { contains: leaveId },
      employeeId: { not: volunteerId },
    },
    data: { isRead: true },
  });

  return { leave, shift, volunteer };
}

/**
 * Auto-assign when 30-minute window expires with no volunteer
 */
export async function autoAssignEmergency(prisma, leaveId) {
  const leave = await prisma.leave.findUnique({
    where: { id: leaveId },
    include: { employee: { include: { venue: true } } },
  });

  if (!leave || leave.status !== 'COVERAGE_PENDING') return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const shift = await prisma.shift.findFirst({
    where: {
      employeeId: leave.employeeId,
      date: today,
      status: 'ASSIGNED',
    },
  });

  if (!shift) return null;

  // Find employee with lightest workload this week
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const eligibleEmployees = await prisma.employee.findMany({
    where: {
      venueId: leave.employee.venueId,
      department: leave.employee.department,
      isActive: true,
      id: { not: leave.employeeId },
    },
    include: {
      shifts: {
        where: { date: { gte: weekStart, lte: weekEnd } },
      },
      leaves: {
        where: {
          status: 'APPROVED',
          startDate: { lte: today },
          endDate: { gte: today },
        },
      },
    },
  });

  const available = eligibleEmployees.filter(emp => {
    if (emp.leaves.length > 0) return false;
    const hasConflict = emp.shifts.some(s => {
      if (new Date(s.date).toDateString() !== today.toDateString()) return false;
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

  // Pick lightest workload
  available.sort((a, b) => a.shifts.length - b.shifts.length);
  const assigned = available[0];

  // Reassign shift
  await prisma.shift.update({
    where: { id: shift.id },
    data: { employeeId: assigned.id, status: 'SWAPPED' },
  });

  await prisma.leave.update({
    where: { id: leaveId },
    data: { status: 'APPROVED', coveredById: assigned.id },
  });

  // Notify auto-assigned employee
  await prisma.notification.create({
    data: {
      employeeId: assigned.id,
      type: 'EMERGENCY_AUTO_ASSIGNED',
      title: '⚠️ Shift Auto-Assigned',
      message: `You have been auto-assigned to cover ${leave.employee.name}'s ${shift.section || ''} shift (${shift.startTime}-${shift.endTime}) today as no volunteer was found.`,
    },
  });

  return { leave, shift, assigned };
}
