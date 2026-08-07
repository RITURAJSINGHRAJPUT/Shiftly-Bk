import { startOfLocalDay, localDateKey, localDateRange } from '../lib/dates.js';

/**
 * Shift Allocation Engine
 * Rule-based auto-allocation with scoring algorithm
 */

/**
 * Roles that can be put on a shift.
 *
 * A head chef runs the kitchen and a master of house runs the floor, so both are
 * working managers and belong in the pool — every restaurant always has one of
 * each. SUPER_ADMIN, ADMIN and HR are organization-level: they are Employee rows
 * only because Employee owns the login, and without this filter the allocator
 * was rostering them onto stations (superadmin@ turned up on Drinks).
 */
const ROSTERABLE_ROLES = ['STAFF', 'HEAD_CHEF', 'MASTER_OF_HOUSE'];

/**
 * Score an employee for a given shift slot
 * @param {object} employee - Employee with shifts, attendance, leaves
 * @param {object} slot - { date, startTime, endTime, section, outletId }
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
 * Auto-allocate shifts for a given date range and outlet
 */
export async function autoAllocateShifts(prisma, outletId, startDate, endDate) {
  const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
  if (!outlet) throw new Error('Outlet not found');

  const employees = await prisma.employee.findMany({
    where: { outletId, isActive: true, role: { in: ROSTERABLE_ROLES } },
    include: { leaves: true },
  });

  // Local-day bounds matter here as much as anywhere: with UTC parsing the
  // first day's existing shifts fell outside the range, so the allocator could
  // not see them and would happily double-book those people.
  const existingShifts = await prisma.shift.findMany({
    where: {
      outletId,
      date: localDateRange(startDate, endDate),
    },
  });

  const allAttendance = await prisma.attendance.findMany({
    where: { employeeId: { in: employees.map(e => e.id) } },
  });

  // This outlet's own patterns. There is deliberately no hardcoded fallback:
  // silently applying a generic set to an outlet with none defined is what hid
  // the fact that every restaurant was being planned identically.
  const templates = await prisma.shiftTemplate.findMany({
    where: { outletId, isActive: true },
    orderBy: [{ department: 'asc' }, { startTime: 'asc' }],
  });

  if (templates.length === 0) {
    return {
      count: 0,
      requested: 0,
      shifts: [],
      shortfalls: [],
      outlet: { id: outlet.id, name: outlet.name },
      message:
        `No shift patterns are defined for ${outlet.name}. Add patterns for this ` +
        `outlet before running allocation.`,
    };
  }

  // --- Weekly off: ensure every employee has 1 approved leave Mon–Thu ------
  // Group dates by ISO week. For each employee without a Mon–Thu leave that
  // week, pick the day where their department has the most other available
  // staff and create an auto-approved leave.
  const dateRange = getDateRange(startDate, endDate);
  const weekBuckets = new Map();
  for (const d of dateRange) {
    const dt = startOfLocalDay(d);
    const day = dt.getDay();
    if (day < 1 || day > 4) continue; // only Mon(1)–Thu(4)
    const thu = new Date(dt);
    thu.setDate(thu.getDate() - (day - 1)); // Monday of this week as key
    const wk = localDateKey(thu);
    if (!weekBuckets.has(wk)) weekBuckets.set(wk, []);
    weekBuckets.get(wk).push(d);
  }

  for (const [, weekDays] of weekBuckets) {
    // Track which department+day combos are already taken so no two
    // same-department employees share an off-day.
    const deptDayTaken = new Set();

    // Seed with existing approved leaves
    for (const emp of employees) {
      for (const l of (emp.leaves || [])) {
        if (l.status !== 'APPROVED') continue;
        for (const wd of weekDays) {
          const d = startOfLocalDay(wd);
          if (d >= new Date(l.startDate) && d <= new Date(l.endDate)) {
            deptDayTaken.add(`${emp.department}:${wd}`);
          }
        }
      }
    }

    for (const emp of employees) {
      const hasOff = emp.leaves?.some(l => {
        if (l.status !== 'APPROVED') return false;
        const ls = new Date(l.startDate);
        const le = new Date(l.endDate);
        return weekDays.some(wd => {
          const d = startOfLocalDay(wd);
          return d >= ls && d <= le;
        });
      });
      if (hasOff) continue;

      // Pick a day where no same-department colleague is already off
      const freeDays = weekDays.filter(wd => !deptDayTaken.has(`${emp.department}:${wd}`));
      const candidates = freeDays.length > 0 ? freeDays : weekDays;

      let bestDay = candidates[0];
      let bestCount = -1;
      for (const wd of candidates) {
        const d = startOfLocalDay(wd);
        const available = employees.filter(e => {
          if (e.id === emp.id) return false;
          if (e.department !== emp.department) return false;
          return !e.leaves?.some(l =>
            l.status === 'APPROVED' && new Date(l.startDate) <= d && new Date(l.endDate) >= d
          );
        }).length;
        if (available > bestCount) {
          bestCount = available;
          bestDay = wd;
        }
      }

      deptDayTaken.add(`${emp.department}:${bestDay}`);

      const offDate = startOfLocalDay(bestDay);
      const leave = await prisma.leave.create({
        data: {
          employeeId: emp.id,
          type: 'CASUAL',
          startDate: offDate,
          endDate: offDate,
          reason: 'Weekly off (auto-assigned)',
          status: 'APPROVED',
          isEmergency: false,
        },
      });
      emp.leaves = [...(emp.leaves || []), leave];
    }
  }

  const newShifts = [];
  const shortfalls = [];
  let requested = 0;

  for (const date of dateRange) {
    // startOfLocalDay, never new Date(date): a date-only string parses as UTC
    // midnight, which is the *previous* day's weekday east of UTC — the same
    // trap lib/dates.js exists to document.
    const weekday = startOfLocalDay(date).getDay();

    for (const template of templates) {
      // Before `requested`, deliberately. Counting a Friday-only pattern's
      // headcount on a Tuesday would inflate demand sevenfold and report a
      // shortfall for staffing nobody ever asked for.
      if (!template.daysOfWeek.includes(weekday)) continue;

      requested += template.headcount;

      const deptEmployees = employees.filter(e => e.department === template.department);
      if (deptEmployees.length === 0) {
        shortfalls.push({
          date,
          template: template.name,
          department: template.department,
          section: template.section,
          needed: template.headcount,
          filled: 0,
          reason: 'no active staff in this department',
        });
        continue;
      }

      const slot = {
        date,
        startTime: template.startTime,
        endTime: template.endTime,
        section: template.section,
        outletId,
      };

      let filled = 0;

      // One pass per required person. Re-scoring between slots is what keeps
      // this correct without any new bookkeeping: scoreEmployee already returns
      // -1000 for anyone holding an overlapping shift, and each pick is pushed
      // into newShifts which is fed back in below — so nobody is booked twice,
      // and the hours-balance and consecutive-day terms update as the week fills.
      for (let i = 0; i < template.headcount; i++) {
        const pool = [...existingShifts, ...newShifts];

        let best = null;
        let bestScore = -Infinity;
        for (const emp of deptEmployees) {
          const score = scoreEmployee(emp, slot, pool, allAttendance);
          if (score > bestScore) {
            bestScore = score;
            best = emp;
          }
        }

        // Everyone left is on leave, already working, or short of rest.
        if (!best || bestScore <= -1000) break;

        newShifts.push({
          // Local midnight, matching the seeder, manual creation and the
          // exact-equality `date:` lookups in the emergency-leave flow. A bare
          // new Date('2026-07-27') is UTC midnight and would miss all of them.
          date: startOfLocalDay(date),
          startTime: template.startTime,
          endTime: template.endTime,
          section: template.section,
          status: 'ASSIGNED',
          employeeId: best.id,
          outletId,
        });
        filled++;
      }

      if (filled < template.headcount) {
        shortfalls.push({
          date,
          template: template.name,
          department: template.department,
          section: template.section,
          needed: template.headcount,
          filled,
          reason: 'no eligible staff left (leave, rest period, or already scheduled)',
        });
      }
    }
  }

  let count = 0;
  if (newShifts.length > 0) {
    const created = await prisma.shift.createMany({ data: newShifts });
    count = created.count;
  }

  return {
    count,
    requested,
    shifts: newShifts,
    shortfalls,
    outlet: { id: outlet.id, name: outlet.name },
  };
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

/** Inclusive list of YYYY-MM-DD local dates between two date strings. */
function getDateRange(start, end) {
  const dates = [];
  const current = startOfLocalDay(start);
  const endDate = startOfLocalDay(end);
  while (current <= endDate) {
    dates.push(localDateKey(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/* getDefaultTemplates() was removed with the fallback it fed. Patterns now come
   only from the outlet's own ShiftTemplate rows — see seedShiftTemplates.js. */
