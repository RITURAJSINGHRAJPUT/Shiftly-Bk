import { ROLE_HIERARCHY } from '../middleware/auth.js';

/**
 * Every guarded action, declared once.
 *
 * This is both the enforcement and the documentation: routes guard with
 * `can('OUTLET_EDIT')` and ACCESS.md is generated from the same object, so the
 * published table cannot describe something the server does not do. A table
 * written by hand would be accurate the day it was written and quietly false
 * afterwards — which is exactly how the login page's hardcoded account list
 * drifted until a button started failing.
 *
 * `minRole` is a floor on ROLE_HIERARCHY, so SUPER_ADMIN inherits everything
 * below it. `requireRole('SUPER_ADMIN')` used to guard the staff wipe; since
 * SUPER_ADMIN is the top of the hierarchy, a floor of SUPER_ADMIN is identical
 * in effect and lets every entry use one field.
 *
 * `note` is for the caveat a label cannot carry — why a capability sits higher
 * than its neighbours.
 *
 * `outletManager: true` is the one exception to the floor, and it is a
 * narrowing, not a widening. OUTLET_MANAGER ties HR's rank, so the floor alone
 * would hand them everything HR holds; the role is meant to run one restaurant's
 * roster and watch its attendance, nothing else. So the rank is ignored for that
 * role entirely and this flag is the whole list. A capability added later
 * without the flag is closed to them by default, which is the way round that
 * fails safe — the previous arrangement let them past every gate and each new
 * capability silently widened the role.
 */
export const CAPABILITIES = {
  ORGANIZATION_CREATE: {
    group: 'Organisation', label: 'Create an organisation', minRole: 'ADMIN',
    note: 'Every brand belongs to one, so an empty database cannot be set up without this.',
  },
  ORGANIZATION_EDIT: {
    group: 'Organisation', label: 'Rename the organisation', minRole: 'ADMIN',
  },
  BRAND_CREATE: {
    group: 'Organisation', label: 'Create a brand', minRole: 'ADMIN',
  },
  BRAND_EDIT: {
    group: 'Organisation', label: 'Edit a brand, including its station list', minRole: 'ADMIN',
    note: 'Station lists drive the Shift Master sheet for every outlet in the brand.',
  },
  OUTLET_CREATE: {
    group: 'Organisation', label: 'Create a restaurant', minRole: 'ADMIN',
  },
  OUTLET_EDIT: {
    group: 'Organisation', label: 'Edit a restaurant, including its geofence', minRole: 'ADMIN',
    note: 'Moving the geofence defeats attendance validation, so this is not a manager-level action, ' +
      'including for the manager of that restaurant.',
  },

  EMPLOYEE_ENROL: {
    group: 'People', label: 'Enrol a staff member at your own restaurant', minRole: 'HEAD_CHEF',
    note: 'A department head knows who works for them and HR does not, so this floor is low on ' +
      'purpose — but it is narrow: their own restaurant, their own department (Head Chef → Kitchen, ' +
      'Master of House → Service and Housekeeping), and the Staff role only. The record is ' +
      'clock-in-only: identified by employee code, with no email and no sign-in.',
  },
  EMPLOYEE_CREATE: {
    group: 'People', label: 'Enrol anyone, anywhere', minRole: 'HR',
    note: 'The unrestricted form of the above — any role, any restaurant, with a login. ' +
      'Checked inside the handler rather than guarding a route of its own, since one endpoint ' +
      'serves both and only the breadth differs.',
  },
  EMPLOYEE_EDIT: {
    group: 'People', label: 'Edit an employee', minRole: 'HR',
  },
  DIRECTORY_EDIT: {
    group: 'People', label: 'Add or correct an entry in the punch directory', minRole: 'HR',
    // Spelled out because the floor cannot say it: OUTLET_MANAGER shares HR's
    // rank, so `minRole: 'HR'` alone would tick their column in ACCESS.md while
    // requireGlobalScope() returns 403. These are exactly GLOBAL_SCOPE_ROLES.
    roles: ['SUPER_ADMIN', 'ADMIN', 'HR'],
    note: 'The directory is who the biometric feed knows about, and it is what the enrolment ' +
      'form reads to turn a code into a name. Department heads read it; only head office writes ' +
      'to it. Enforced with hasGlobalScope() rather than this floor, because OUTLET_MANAGER ' +
      'shares HR\u2019s rank and would otherwise clear it.',
  },
  EMPLOYEE_RESET_PW: {
    group: 'People', label: 'Issue a new one-time password', minRole: 'HR',
    note: 'The same floor as enrolment, because it is the same act from the other end: HR issues the ' +
      'first one-time password when they enrol someone, and a lost password is simply that again. ' +
      'Holding this above enrolment meant the role that creates accounts could not help the person ' +
      'whose password it had handed them. A department head still cannot — they enrol clock-in-only ' +
      'records, which have no sign-in to take over.',
  },
  EMPLOYEE_DEACTIVATE: {
    group: 'People', label: 'Deactivate an employee', minRole: 'HR',
    note: 'Deactivation is a real lockout — the login handler refuses an inactive account. ' +
      'HR can deactivate anyone except management accounts (Super Admin, Admin, HR), matching ' +
      'the rule that HR cannot assign those roles.',
  },
  STAFF_WIPE_PREVIEW: {
    group: 'People', label: 'See what a staff wipe would delete', minRole: 'SUPER_ADMIN',
  },
  STAFF_WIPE: {
    group: 'People', label: 'Delete every staff account and their history', minRole: 'SUPER_ADMIN',
    note: 'Irreversible, and behind a typed confirmation as well as this role.',
  },

  SHIFT_CREATE: {
    group: 'Shifts', label: 'Add a shift', minRole: 'HEAD_CHEF',
    outletManager: true,
  },
  SHIFT_EDIT: {
    group: 'Shifts', label: 'Edit a shift', minRole: 'HEAD_CHEF',
    outletManager: true,
  },
  SHIFT_ALLOCATE: {
    group: 'Shifts', label: 'Run auto-allocation for a week', minRole: 'HEAD_CHEF',
    outletManager: true,
  },
  SHIFT_DELETE: {
    group: 'Shifts', label: 'Delete a shift', minRole: 'ADMIN',
    note: 'Higher than creating one: a deleted shift leaves no record that it existed. ' +
      'An Outlet Manager builds the roster but cannot erase parts of it.',
  },
  SHIFT_RESET_PREVIEW: {
    group: 'Shifts', label: 'See what resetting a restaurant would delete', minRole: 'ADMIN',
  },
  SHIFT_RESET: {
    group: 'Shifts', label: "Delete every shift at one restaurant", minRole: 'ADMIN',
    note: 'The whole roster at once, for all time and every status — including ' +
      'completed shifts, which the dashboard counts for its attendance history. ' +
      'Same floor as deleting a single shift, since this is strictly more ' +
      'destructive. Also required to tick "delete shifts too" when clearing shift ' +
      'patterns, which reaches the same outcome.',
  },

  PATTERN_CREATE: {
    group: 'Shift patterns', label: 'Add a shift pattern', minRole: 'HEAD_CHEF',
    outletManager: true,
  },
  PATTERN_BULK: {
    group: 'Shift patterns', label: 'Add one pattern across several restaurants', minRole: 'HEAD_CHEF',
    outletManager: true,
    note: 'Each restaurant is checked separately, so a head chef can only reach their own.',
  },
  PATTERN_GRID: {
    group: 'Shift patterns', label: 'Save the weekly shift sheet', minRole: 'HEAD_CHEF',
    outletManager: true,
  },
  PATTERN_EDIT: {
    group: 'Shift patterns', label: 'Edit a shift pattern', minRole: 'HEAD_CHEF',
    outletManager: true,
  },
  PATTERN_DELETE: {
    group: 'Shift patterns', label: 'Delete a shift pattern', minRole: 'HEAD_CHEF',
    outletManager: true,
  },
  PATTERN_CLEAR: {
    group: 'Shift patterns', label: "Clear a restaurant's patterns", minRole: 'HEAD_CHEF',
    outletManager: true,
  },
  PATTERN_CLEAR_PREVIEW: {
    group: 'Shift patterns', label: 'See what clearing would delete', minRole: 'HEAD_CHEF',
    outletManager: true,
  },

  ATTENDANCE_VIEW_ALL: {
    group: 'Attendance', label: "See other people's attendance", minRole: 'HEAD_CHEF',
    outletManager: true,
    note: 'Everyone can always see their own record. An Outlet Manager, Master of House or Head ' +
      'Chef sees every employee at their own restaurant, every department; HR and above see every ' +
      'restaurant. Seeing is broader than approving — overtime is still signed off only by the head ' +
      'of that department, and an Outlet Manager cannot sign off any of it. Administration roles ' +
      'never clock in, so their rows are hidden from the list.',
  },

  ATTENDANCE_SYNC: {
    group: 'Attendance', label: 'Pull attendance from the punch log', minRole: 'HR',
    note: 'Higher than viewing it: the pull is organisation-wide by nature, so it ' +
      'writes every restaurant\'s rows, not just the caller\'s own — and this is the ' +
      'version where the caller picks the dates. Keeping attendance current does not ' +
      'need it: opening the Attendance page refreshes anything older than fifteen ' +
      'minutes for every role, over a fixed window nobody can widen, and fills in the ' +
      'month for anyone enrolled since the last pull.',
  },
  OVERTIME_APPROVE: {
    group: 'Attendance', label: 'Approve overtime', minRole: 'HEAD_CHEF',
    note: 'Only for your own department, at your own restaurant, and never your own ' +
      'overtime — enforced per record. A Master of House or Head Chef signs off the hours of the ' +
      'people they run; an Outlet Manager sees those hours but does not decide them, which is the ' +
      'point of the two being separate roles.',
  },
  OVERTIME_REJECT: {
    group: 'Attendance', label: 'Reject overtime', minRole: 'HEAD_CHEF',
  },

  LEAVE_APPROVE: {
    group: 'Leave', label: 'Approve a leave request', minRole: 'HEAD_CHEF',
    note: 'Your own department, at your own restaurant, and never your own request — ' +
      'enforced per record. A single quiet weekday off still auto-approves on submission ' +
      'without passing through this at all. Like overtime, this belongs to the department ' +
      'head rather than the Outlet Manager.',
  },
  LEAVE_REJECT: {
    group: 'Leave', label: 'Reject a leave request', minRole: 'HEAD_CHEF',
  },
  LEAVE_AUTO_ASSIGN: {
    group: 'Leave', label: 'Auto-assign cover for emergency leave', minRole: 'HEAD_CHEF',
  },

  TRANSFER_APPROVE: {
    group: 'Transfers', label: 'Approve a transfer request', minRole: 'HEAD_CHEF',
  },
  TRANSFER_REJECT: {
    group: 'Transfers', label: 'Reject a transfer request', minRole: 'HEAD_CHEF',
  },

  AUDIT_VIEW: {
    group: 'System', label: 'View audit logs', minRole: 'ADMIN',
  },
};

/**
 * The guard for a capability.
 *
 * Routes name a capability, never a role — that is what makes the generated
 * table impossible to drift from what the server enforces, rather than merely
 * unlikely to.
 */
export function can(key) {
  const capability = CAPABILITIES[key];
  // Thrown at import time, not on the first request: a typo here would otherwise
  // produce a route with no guard at all, which fails open.
  if (!capability) throw new Error(`Unknown capability "${key}"`);
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (roleHolds(req.user.role, key)) return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}

/**
 * Whether a role holds a capability at all. One rule, three callers: the
 * middleware above, the in-handler checks that a route guard cannot express,
 * and ACCESS.md's generator — so the published table and the enforcement are
 * the same function rather than two readings of the same data.
 *
 * Three tiers, most specific first:
 *
 *  1. `roles` — an outright list, for the few capabilities enforced by
 *     something other than rank (DIRECTORY_EDIT goes through hasGlobalScope()).
 *  2. OUTLET_MANAGER — the flag only, never the rank. See the note on
 *     `outletManager` at the top of this file.
 *  3. everyone else — the rank floor, so each role inherits the ones below it.
 *
 * This only says the role may attempt the action. Every route still has to
 * verify the acted-on record belongs to the caller's own outlet, the way
 * outletShiftDenied()/leaveApprovalDenied() do.
 */
export function roleHolds(role, key) {
  const capability = CAPABILITIES[key];
  if (!capability) throw new Error(`Unknown capability "${key}"`);
  if (!role) return false;
  if (Array.isArray(capability.roles)) return capability.roles.includes(role);
  if (role === 'OUTLET_MANAGER') return capability.outletManager === true;
  return (ROLE_HIERARCHY[role] || 0) >= (ROLE_HIERARCHY[capability.minRole] || 0);
}

/** roleHolds() for a request's user, which may be absent. */
export function holdsCapability(user, key) {
  if (!user) {
    // Still resolve the key, so a typo throws here rather than lying "no" to
    // every anonymous caller and only surfacing once someone signs in.
    if (!CAPABILITIES[key]) throw new Error(`Unknown capability "${key}"`);
    return false;
  }
  return roleHolds(user.role, key);
}
