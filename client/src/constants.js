/**
 * Shared constants.
 *
 * MOBILE_BREAKPOINT must stay in sync with the `max-width` media query in
 * index.css. It lives here because App.jsx uses it to decide whether to mount
 * <Sidebar> or <MobileNav>, and the two must not disagree.
 */
export const MOBILE_BREAKPOINT = 768;

/** localStorage key for the sidebar's collapsed/expanded preference. */
export const SIDEBAR_COLLAPSED_KEY = 'shiftly_sidebar_collapsed';

export const ROLES = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  HR: 'HR',
  OUTLET_MANAGER: 'Outlet Manager',
  MASTER_OF_HOUSE: 'Master of House',
  HEAD_CHEF: 'Head Chef',
  STAFF: 'Staff',
};

export const DEPARTMENTS = ['KITCHEN', 'SERVICE', 'HOUSEKEEPING'];

export const STATIONS = ['Pizza', 'Pasta', 'Drinks', 'Sushi', 'Wok', 'Side', 'Pass'];

export const departmentHasStations = (department) => department === 'KITCHEN';

/**
 * Shift rows per station on the sheet.
 *
 * Two by default, because that is how the paper sheets are drawn and an empty
 * third row on every station is noise. Stations that need a late close can grow
 * to six — beyond that the grid stops being readable, and a station running
 * seven distinct shifts is a sign the station itself should be split.
 */
export const MIN_SHIFT_SLOTS = 2;
export const MAX_SHIFT_SLOTS = 6;

/** `[1, 2, … n]` — the slot numbers to draw for one station. */
export const slotsUpTo = (n) => Array.from({ length: n }, (_, i) => i + 1);

/**
 * The grid's rows for one outlet, in sheet order: the brand's kitchen stations
 * first, then the two departments that have no station of their own.
 *
 * `key` is what the grid's state is keyed by, so it has to survive a station
 * being renamed away and back — department plus section is exactly identifying.
 */
export function gridRows(brandStations = [], departments = null) {
  const all = [
    ...brandStations.map((section) => ({
      key: `KITCHEN|${section}`,
      label: section,
      department: 'KITCHEN',
      section,
    })),
    { key: 'SERVICE|Service', label: 'Service', department: 'SERVICE', section: 'Service' },
    { key: 'HOUSEKEEPING|Housekeeping', label: 'House Keeping', department: 'HOUSEKEEPING', section: 'Housekeeping' },
  ];

  // `departments` null means every row — a global role or an outlet manager.
  // A department head gets only what they own, otherwise the sheet shows rows
  // the server will refuse on save. That was most obvious at a brand with no
  // kitchen stations: the Kitchen rows come from the station list, so a head
  // chef there saw Service and House Keeping and nothing else — exactly the two
  // departments they may not touch.
  if (!departments?.length) return all;
  return all.filter((r) => departments.includes(r.department));
}

/** Roles that can see data across every outlet rather than just their own. */
export const GLOBAL_SCOPE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

/**
 * Mirrors the ATTENDANCE_VIEW_ALL capability (server/src/lib/capabilities.js).
 * Everyone else sees only their own record, which the server enforces
 * regardless — this only decides which view to render.
 */
export const ATTENDANCE_VIEW_ALL_ROLES = [
  'SUPER_ADMIN', 'ADMIN', 'HR', 'OUTLET_MANAGER', 'MASTER_OF_HOUSE', 'HEAD_CHEF',
];

/**
 * Mirrors ATTENDANCE_SYNC — the pull is org-wide, so it sits higher. An Outlet
 * Manager sees every record at their restaurant and pulls none of them: the
 * import writes every restaurant's rows, which is not theirs to trigger.
 */
export const ATTENDANCE_SYNC_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

/**
 * Mirrors server/src/lib/departments.js. A locked manager acts only on their
 * own department; global roles act on any.
 *
 * The client is a separate package with no shared alias, so this is a copy by
 * necessity — but there is now one copy on each side rather than two.
 */
export const DEPARTMENT_APPROVERS = {
  KITCHEN: 'HEAD_CHEF',
  SERVICE: 'MASTER_OF_HOUSE',
  HOUSEKEEPING: 'MASTER_OF_HOUSE',
};

/**
 * The inverse: which departments a role may enrol into.
 *
 * Derived from the role, never from the manager's own `department` field — a
 * Master of House is stored as SERVICE but owns HOUSEKEEPING too.
 */
export function departmentsFor(role) {
  return Object.entries(DEPARTMENT_APPROVERS)
    .filter(([, owner]) => owner === role)
    .map(([department]) => department);
}

/**
 * Whether this user may record, change or cancel leave for `employee`.
 *
 * Mirrors leaveApprovalDenied() on the server, which is what LEAVE_MANAGE is
 * checked against: global roles act on anyone, a department head on their own
 * department, nobody on themselves, and an Outlet Manager on nobody.
 */
export function canManageLeaveOf(user, employee) {
  if (!user || !employee) return false;
  if (GLOBAL_SCOPE_ROLES.includes(user.role)) return true;
  if (employee.id === user.id) return false;
  return DEPARTMENT_APPROVERS[employee.department] === user.role;
}

/** Mirrors AUTO_OFF_REASON in server/src/engine/shiftAllocator.js. */
export const AUTO_OFF_REASON = 'Weekly off (auto-assigned)';

/** The standard working day, in minutes. Mirrors WORKDAY_MINUTES on the server. */
export const WORKDAY_MINUTES = 9 * 60;

/**
 * Weekday numbering matches `Date.getDay()` — Sunday is 0 — which is what the
 * server stores on ShiftTemplate.daysOfWeek and what both the allocator and the
 * week grid already hold dates in, so nothing converts anywhere.
 *
 * The order here is Monday-first, matching Shift Planning's
 * `startOfWeek(..., { weekStartsOn: 1 })`, so iterating this renders a week the
 * way the rest of the app draws one.
 */
export const WEEKDAYS = [
  { value: 1, short: 'Mon', letter: 'M', label: 'Monday' },
  { value: 2, short: 'Tue', letter: 'T', label: 'Tuesday' },
  { value: 3, short: 'Wed', letter: 'W', label: 'Wednesday' },
  { value: 4, short: 'Thu', letter: 'T', label: 'Thursday' },
  { value: 5, short: 'Fri', letter: 'F', label: 'Friday' },
  { value: 6, short: 'Sat', letter: 'S', label: 'Saturday' },
  { value: 0, short: 'Sun', letter: 'S', label: 'Sunday' },
];

export const ALL_WEEKDAYS = WEEKDAYS.map((d) => d.value);

/**
 * "Every day", "Mon–Thu", "Fri, Sat, Sun" — runs of three or more collapse to a
 * dash so a table cell stays scannable. Read in Monday-first order, not numeric:
 * Sunday is 0, so sorting by value would render Fri–Sun as "Sun, Fri, Sat".
 */
export function formatDays(days) {
  if (!Array.isArray(days) || days.length === 0) return 'Never';
  if (days.length === 7) return 'Every day';

  const ordered = WEEKDAYS.filter((d) => days.includes(d.value));

  const runs = [];
  for (const day of ordered) {
    const last = runs[runs.length - 1];
    // Adjacent in the Monday-first ordering, which is what a reader expects a
    // dash to mean — Sat and Sun are a run even though their values are 6 and 0.
    const prevIndex = last ? WEEKDAYS.findIndex((d) => d.value === last[last.length - 1].value) : -2;
    const thisIndex = WEEKDAYS.findIndex((d) => d.value === day.value);
    if (thisIndex === prevIndex + 1) last.push(day);
    else runs.push([day]);
  }

  return runs
    .map((run) => (run.length >= 3 ? `${run[0].short}–${run[run.length - 1].short}` : run.map((d) => d.short).join(', ')))
    .join(', ');
}
