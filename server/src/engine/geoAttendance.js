/**
 * Geofenced Attendance Engine
 * Uses Haversine formula to validate check-in/out within outlet radius
 */

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
 * Process check-in with geolocation validation
 */
export async function processCheckIn(prisma, employeeId, latitude, longitude) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { outlet: true },
  });

  if (!employee) throw new Error('Employee not found');

  const geoResult = isWithinGeofence(latitude, longitude, employee.outlet);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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

  // Determine if late (more than 15 min after shift start)
  const todayShift = await prisma.shift.findFirst({
    where: {
      employeeId,
      date: today,
      status: 'ASSIGNED',
    },
  });

  let status = 'CHECKED_IN';
  if (todayShift) {
    const [sh, sm] = todayShift.startTime.split(':').map(Number);
    const shiftStart = new Date(today);
    shiftStart.setHours(sh, sm, 0, 0);
    if (now > new Date(shiftStart.getTime() + 15 * 60 * 1000)) {
      status = 'LATE';
    }
  }

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
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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
