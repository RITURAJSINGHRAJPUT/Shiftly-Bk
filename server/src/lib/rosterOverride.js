import { holdsCapability } from './capabilities.js';
import { ownsDepartment } from './departments.js';

/**
 * Whether `user` may overrule the roster for `employee`: call them in on a day
 * of approved leave, or give them leave on a day they are rostered.
 *
 * One rule for both directions (LEAVE_ROSTER_OVERRIDE), so the shift and leave
 * routes cannot drift apart. Only the head of the person's own department — a
 * Head Chef for Kitchen, a Master of House for Service and Housekeeping — and
 * never for themselves. Outlet is not checked here; both callers have already
 * pinned the record to the caller's outlet.
 *
 * `reason` completes the sentence "<name> ...", e.g. "is on leave that day".
 * Returns an error string, or null when allowed.
 */
export function rosterOverrideDenied(user, employee, reason) {
  if (!holdsCapability(user, 'LEAVE_ROSTER_OVERRIDE') || !ownsDepartment(user.role, employee.department)) {
    const head = employee.department === 'KITCHEN' ? 'Head Chef' : 'Master of House';
    return `${employee.name} ${reason}. Only the ${head} can change that.`;
  }
  if (employee.id === user.id) return 'You cannot overrule the roster for yourself';
  return null;
}

/**
 * Whether `user` may send `employee` to ODC, or change or remove their ODC.
 *
 * SHIFT_ODC: the department head, for their own department. Admin and HR plan
 * the restaurant; who goes out to a catering job is the head's call, the same
 * reasoning as calling someone in from leave.
 */
export function odcDenied(user, employee) {
  if (!holdsCapability(user, 'SHIFT_ODC') || !ownsDepartment(user.role, employee.department)) {
    const head = employee.department === 'KITCHEN' ? 'Head Chef' : 'Master of House';
    return `Only the ${head} can send ${employee.name} to ODC`;
  }
  return null;
}
