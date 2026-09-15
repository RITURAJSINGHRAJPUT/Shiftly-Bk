/**
 * Geofenced Attendance Engine
 * Uses Haversine formula to validate check-in/out within outlet radius
 */
import { attendanceDayFor } from '../lib/dates.js';

/**
 * Calculate distance between two points using Haversine formula
 * @returns {number} Distance in meters
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Validate if coordinates are within outlet geofence
 */
export function isWithinGeofence(userLat, userLng, outlet) {
  const distance = haversineDistance(userLat, userLng, outlet.latitude, outlet.longitude);
  return {
    withinRange: distance <= outlet.radius,
    distance: Math.round(distance),
    radius: outlet.radius,
  };
}

/**
 * Whether a check-in counts as late (more than 15 min after the employee's
 * assigned shift start that day), or CHECKED_OUT if a check-out time is
 * already known — matching processCheckOut() below, which always resolves to
 * CHECKED_OUT regardless of the morning's lateness. Shared by the live
 * self-check-in flow and the external attendance import, so "late" is
 * defined once.
 */
export async function determineAttendanceStatus(prisma, employeeId, date, checkInTime, hasCheckOut = false) {
  if (hasCheckOut) return 'CHECKED_OUT';

  const dayShift = await prisma.shift.findFirst({
    where: { employeeId, date, status: 'ASSIGNED' },
  });

  return statusFor(dayShift, date, checkInTime, hasCheckOut);
}

/**
 * The same decision with the shift already in hand.
 *
 * Split out for the importer, which processes thousands of employee-days in one
 * run: looking each shift up individually made the loop two sequential round
 * trips per day, which is minutes of wall clock over a month and long enough to
 * time out the browser. It prefetches the window's shifts in one query and
 * calls this instead. The live check-in path above is unchanged.
 */
export function statusFor(dayShift, date, checkInTime, hasCheckOut = false) {
  if (hasCheckOut) return 'CHECKED_OUT';

  if (dayShift) {
    const [sh, sm] = dayShift.startTime.split(':').map(Number);
    const shiftStart = new Date(date);
    shiftStart.setHours(sh, sm, 0, 0);
    if (checkInTime > new Date(shiftStart.getTime() + 15 * 60 * 1000)) {
      return 'LATE';
    }
  }

  return 'CHECKED_IN';
}

/**
 * Process check-in with geolocation validation
 */
export async function processCheckIn(prisma, employeeId, latitude, longitude) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { outlet: true },
  });

  if (!employee) throw new Error('Employee not found');

  const geoResult = isWithinGeofence(latitude, longitude, employee.outlet);
  // Which working day this counts as, not which calendar day it is — the same
  // boundary the importer uses. If these two disagreed, a night worker who taps
  // the app at 02:00 and the biometric reader at 02:05 would get two Attendance
  // rows for one shift, and the unique constraint could not catch it because
  // the dates would genuinely differ.
  const today = attendanceDayFor(new Date());

  // Check if already checked in today
  const existing = await prisma.attendance.findUnique({
    where: {
      employeeId_date: {
        employeeId,
        date: today,
      },
    },
  });

  if (existing && existing.checkIn) {
    throw new Error('Already checked in today');
  }

  const now = new Date();
  const status = await determineAttendanceStatus(prisma, employeeId, today, now);

  const attendance = await prisma.attendance.upsert({
    where: {
      employeeId_date: { employeeId, date: today },
    },
    update: {
      checkIn: now,
      checkInLat: latitude,
      checkInLng: longitude,
      withinRange: geoResult.withinRange,
      status,
    },
    create: {
      employeeId,
      date: today,
      checkIn: now,
      checkInLat: latitude,
      checkInLng: longitude,
      withinRange: geoResult.withinRange,
      status,
    },
  });

  return { attendance, geo: geoResult };
}

/**
 * Process check-out with geolocation validation
 */
export async function processCheckOut(prisma, employeeId, latitude, longitude) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { outlet: true },
  });

  if (!employee) throw new Error('Employee not found');

  const geoResult = isWithinGeofence(latitude, longitude, employee.outlet);
  // Same working-day boundary as the check-in above, so a shift that runs past
  // midnight closes the row it opened.
  const today = attendanceDayFor(new Date());

  const existing = await prisma.attendance.findUnique({
    where: {
      employeeId_date: { employeeId, date: today },
    },
  });

  if (!existing || !existing.checkIn) {
    throw new Error('Must check in before checking out');
  }

  if (existing.checkOut) {
    throw new Error('Already checked out today');
  }

  const attendance = await prisma.attendance.update({
    where: { id: existing.id },
    data: {
      checkOut: new Date(),
      checkOutLat: latitude,
      checkOutLng: longitude,
      status: 'CHECKED_OUT',
    },
  });

  return { attendance, geo: geoResult };
}
