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
  MASTER_OF_HOUSE: 'Master of House',
  HEAD_CHEF: 'Head Chef',
  STAFF: 'Staff',
};

export const DEPARTMENTS = ['KITCHEN', 'SERVICE', 'HOUSEKEEPING'];

export const STATIONS = ['Pizza', 'Pasta', 'Drinks', 'Sushi', 'Wok', 'Side', 'Pass'];

export const departmentHasStations = () => true;

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
export function gridRows(brandStations = []) {
  return [
    ...brandStations.map((section) => ({
      key: `KITCHEN|${section}`,
      label: section,
      department: 'KITCHEN',
      section,
    })),
    { key: 'SERVICE|Service', label: 'Service', department: 'SERVICE', section: 'Service' },
    { key: 'HOUSEKEEPING|Housekeeping', label: 'House Keeping', department: 'HOUSEKEEPING', section: 'Housekeeping' },
  ];
}

/** Roles that can see data across every outlet rather than just their own. */
export const GLOBAL_SCOPE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

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
