/**
 * Shift Allocation Engine
 * Rule-based auto-allocation with scoring algorithm
 */

/**
 * Score an employee for a given shift slot
 * @param {object} employee - Employee with shifts, attendance, leaves
 * @param {object} slot - { date, startTime, endTime, section, venueId }
 * @param {object[]} existingShifts - All shifts for the week
 * @returns {number} score (higher = better fit)
 */
export function scoreEmployee(employee, slot, existingShifts, allAttendance) {
  let score = 0;

  // 1. SKILL MATCH (+30) — employee has worked this section before
  if (slot.section && employee.skills.includes(slot.section.toLowerCase())) {
    score += 30;
  }

  // 2. HISTORICAL RELIABILITY (+25) — attendance percentage
  if (allAttendance && allAttendance.length > 0) {
    const empAttendance = allAttendance.filter(a => a.employeeId === employee.id);
    const total = empAttendance.length || 1;
    const present = empAttendance.filter(a =>
      a.status === 'CHECKED_IN' || a.status === 'CHECKED_OUT'
    ).length;
    const reliability = (present / total) * 25;
    score += Math.round(reliability);
  } else {
    score += 20; // default for new employees
  }

  // 3. HOURS BALANCE (+20) — fewer hours this week = higher score
  const weekShifts = existingShifts.filter(s => s.employeeId === employee.id);
  const hoursThisWeek = weekShifts.reduce((sum, s) => {
    return sum + getShiftHours(s.startTime, s.endTime);
  }, 0);
  const maxWeeklyHours = 48;
  const hoursScore = Math.max(0, ((maxWeeklyHours - hoursThisWeek) / maxWeeklyHours) * 20);
  score += Math.round(hoursScore);

  // 4. AVAILABILITY (+15) — not on leave, not already assigned
  const isOnLeave = employee.leaves?.some(l => {
    const leaveStart = new Date(l.startDate);
    const leaveEnd = new Date(l.endDate);
    const shiftDate = new Date(slot.date);
    return l.status === 'APPROVED' && shiftDate >= leaveStart && shiftDate <= leaveEnd;
  });
  if (isOnLeave) return -1000; // hard constraint

  const isAlreadyAssigned = existingShifts.some(s => {
    return s.employeeId === employee.id &&
      new Date(s.date).toDateString() === new Date(slot.date).toDateString() &&
      hasTimeOverlap(s.startTime, s.endTime, slot.startTime, slot.endTime);
  });
  if (isAlreadyAssigned) return -1000; // hard constraint

  score += 15;

  // 5. CONSECUTIVE DAYS (-10) — penalize > 5 consecutive days
  const consecutiveDays = getConsecutiveDays(employee.id, existingShifts, slot.date);
  if (consecutiveDays >= 5) {
    score -= 10 * (consecutiveDays - 4);
  }

  // 6. REST PERIOD (HARD CONSTRAINT) — must have ≥ 8 hours gap
  const hasAdequateRest = checkRestPeriod(employee.id, existingShifts, slot);
  if (!hasAdequateRest) return -1000;

  return score;
}

/**
 * Auto-allocate shifts for a given date range and venue
 */
export async function autoAllocateShifts(prisma, venueId, startDate, endDate) {
  const venue = await prisma.venue.findUnique({ where: { id: venueId } });
  if (!venue) throw new Error('Venue not found');

  const employees = await prisma.employee.findMany({
    where: { venueId, isActive: true },
    include: { leaves: true },
  });

  const existingShifts = await prisma.shift.findMany({
    where: {
      venueId,
      date: { gte: new Date(startDate), lte: new Date(endDate) },
    },
  });

  const allAttendance = await prisma.attendance.findMany({
    where: { employeeId: { in: employees.map(e => e.id) } },
  });

  // Get shift templates or use defaults
  const templates = await prisma.shiftTemplate.findMany();
  const defaultTemplates = templates.length > 0 ? templates : getDefaultTemplates();

  const newShifts = [];
  const dateRange = getDateRange(startDate, endDate);

  for (const date of dateRange) {
    for (const template of defaultTemplates) {
      // Find eligible employees for this department
      const deptEmployees = employees.filter(e => e.department === template.department);

      if (deptEmployees.length === 0) continue;

      // Score each employee
      const scored = deptEmployees.map(emp => ({
        employee: emp,
        score: scoreEmployee(emp, {
          date,
          startTime: template.startTime,
          endTime: template.endTime,
          section: template.section,
          venueId,
        }, [...existingShifts, ...newShifts], allAttendance),
      }));

      // Sort by score (highest first) and pick the best
      scored.sort((a, b) => b.score - a.score);

      const best = scored[0];
      if (best && best.score > -1000) {
        const shift = {
          date: new Date(date),
          startTime: template.startTime,
          endTime: template.endTime,
          section: template.section,
          status: 'ASSIGNED',
          employeeId: best.employee.id,
          venueId,
        };
        newShifts.push(shift);
      }
    }
  }

  // Bulk create shifts
  if (newShifts.length > 0) {
    const created = await prisma.shift.createMany({ data: newShifts });
    return { count: created.count, shifts: newShifts };
  }

  return { count: 0, shifts: [] };
}

// Helper functions
function getShiftHours(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let hours = eh - sh + (em - sm) / 60;
  if (hours < 0) hours += 24; // overnight shift
  return hours;
}

function hasTimeOverlap(s1Start, s1End, s2Start, s2End) {
  const toMin = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const a1 = toMin(s1Start), b1 = toMin(s1End);
  const a2 = toMin(s2Start), b2 = toMin(s2End);
  return a1 < b2 && a2 < b1;
}

function getConsecutiveDays(employeeId, shifts, currentDate) {
  const empShifts = shifts.filter(s => s.employeeId === employeeId);
  const dates = empShifts.map(s => new Date(s.date).toDateString());
  dates.push(new Date(currentDate).toDateString());
  const unique = [...new Set(dates)].sort();
  let consecutive = 1;
  for (let i = unique.length - 1; i > 0; i--) {
    const curr = new Date(unique[i]);
    const prev = new Date(unique[i - 1]);
    const diff = (curr - prev) / (1000 * 60 * 60 * 24);
    if (diff === 1) consecutive++;
    else break;
  }
  return consecutive;
}

function checkRestPeriod(employeeId, shifts, slot) {
  const empShifts = shifts.filter(s => s.employeeId === employeeId);
  const slotDate = new Date(slot.date);

  for (const s of empShifts) {
    const sDate = new Date(s.date);
    const dayDiff = Math.abs((slotDate - sDate) / (1000 * 60 * 60 * 24));
    if (dayDiff > 1) continue;

    // Check if rest period is adequate
    const [seh] = s.endTime.split(':').map(Number);
    const [ssh] = slot.startTime.split(':').map(Number);

    if (sDate.toDateString() === slotDate.toDateString()) continue;

    let gap;
    if (sDate < slotDate) {
      gap = (24 - seh) + ssh;
    } else {
      const [slotEnd] = slot.endTime.split(':').map(Number);
      gap = (24 - slotEnd) + parseInt(s.startTime);
    }
    if (gap < 8) return false;
  }
  return true;
}

function getDateRange(start, end) {
  const dates = [];
  const current = new Date(start);
  const endDate = new Date(end);
  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function getDefaultTemplates() {
  return [
    { startTime: '12:00', endTime: '21:00', section: 'Pizza', department: 'KITCHEN' },
    { startTime: '12:00', endTime: '21:00', section: 'Pasta', department: 'KITCHEN' },
    { startTime: '12:00', endTime: '21:00', section: 'Drinks', department: 'KITCHEN' },
    { startTime: '13:00', endTime: '22:00', section: null, department: 'SERVICE' },
    { startTime: '14:00', endTime: '23:00', section: null, department: 'SERVICE' },
    { startTime: '12:00', endTime: '22:00', section: null, department: 'HOUSEKEEPING' },
  ];
}
