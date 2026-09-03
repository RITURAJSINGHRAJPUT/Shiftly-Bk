import { requireMinRole } from '../middleware/auth.js';

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
    note: 'Moving the geofence defeats attendance validation, so this is not a manager-level action. ' +
      'Exception: an Outlet Manager may edit their own outlet — see canOrOutletManager() in this file.',
  },

  EMPLOYEE_CREATE: {
    group: 'People', label: 'Enrol an employee', minRole: 'HR',
  },
  EMPLOYEE_EDIT: {
    group: 'People', label: 'Edit an employee', minRole: 'HR',
  },
  EMPLOYEE_RESET_PW: {
    group: 'People', label: 'Issue a new one-time password', minRole: 'ADMIN',
    note: 'Higher than enrolment: this takes over an existing account rather than creating a new one. ' +
      'Exception: an Outlet Manager may reset a password for staff at their own outlet.',
  },
  EMPLOYEE_DEACTIVATE: {
    group: 'People', label: 'Deactivate an employee', minRole: 'ADMIN',
    note: 'Deactivation is a real lockout — the login handler refuses an inactive account. ' +
      'Exception: an Outlet Manager may deactivate staff at their own outlet.',
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
  },
  SHIFT_EDIT: {
    group: 'Shifts', label: 'Edit a shift', minRole: 'HEAD_CHEF',
  },
  SHIFT_ALLOCATE: {
    group: 'Shifts', label: 'Run auto-allocation for a week', minRole: 'HEAD_CHEF',
  },
  SHIFT_DELETE: {
    group: 'Shifts', label: 'Delete a shift', minRole: 'ADMIN',
    note: 'Higher than creating one: a deleted shift leaves no record that it existed. ' +
      'Exception: an Outlet Manager may delete a shift at their own outlet.',
  },

  PATTERN_CREATE: {
    group: 'Shift patterns', label: 'Add a shift pattern', minRole: 'HEAD_CHEF',
  },
  PATTERN_BULK: {
    group: 'Shift patterns', label: 'Add one pattern across several restaurants', minRole: 'HEAD_CHEF',
    note: 'Each restaurant is checked separately, so a head chef can only reach their own.',
  },
  PATTERN_GRID: {
    group: 'Shift patterns', label: 'Save the weekly shift sheet', minRole: 'HEAD_CHEF',
  },
  PATTERN_EDIT: {
    group: 'Shift patterns', label: 'Edit a shift pattern', minRole: 'HEAD_CHEF',
  },
  PATTERN_DELETE: {
    group: 'Shift patterns', label: 'Delete a shift pattern', minRole: 'HEAD_CHEF',
  },
  PATTERN_CLEAR: {
    group: 'Shift patterns', label: "Clear a restaurant's patterns", minRole: 'HEAD_CHEF',
  },
  PATTERN_CLEAR_PREVIEW: {
    group: 'Shift patterns', label: 'See what clearing would delete', minRole: 'HEAD_CHEF',
  },

  LEAVE_APPROVE: {
    group: 'Leave', label: 'Approve a leave request', minRole: 'HEAD_CHEF',
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
  return requireMinRole(capability.minRole);
}

/**
 * Same gate as can(), but also lets an OUTLET_MANAGER through regardless of
 * the capability's floor.
 *
 * For the handful of capabilities pinned above OUTLET_MANAGER's own rank
 * (EMPLOYEE_RESET_PW, EMPLOYEE_DEACTIVATE, OUTLET_EDIT, SHIFT_DELETE — all
 * ADMIN-floor), lowering the floor itself would hand HR the same rights,
 * since HR ties OUTLET_MANAGER's rank. Bypassing the floor for this one role
 * instead leaves HR's permissions exactly as they are.
 *
 * This only gets an OUTLET_MANAGER past the door — every route using this
 * still has to verify the acted-on resource belongs to their own outlet, the
 * same way outletWriteDenied()/leaveApprovalDenied() already do for other
 * capabilities.
 */
export function canOrOutletManager(key) {
  const capability = CAPABILITIES[key];
  if (!capability) throw new Error(`Unknown capability "${key}"`);
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.role === 'OUTLET_MANAGER') return next();
    return requireMinRole(capability.minRole)(req, res, next);
  };
}
