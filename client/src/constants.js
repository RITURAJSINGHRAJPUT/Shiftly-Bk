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

/** Roles that can see data across every outlet rather than just their own. */
export const GLOBAL_SCOPE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];
