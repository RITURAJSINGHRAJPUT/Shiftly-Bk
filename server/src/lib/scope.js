import { departmentsFor } from './departments.js';

/**
 * Org / Brand / Outlet scoping.
 *
 * The client's top bar exposes three cascading selectors. They arrive as
 * `?org=`, `?brand=`, `?outlet=` and resolve to a Prisma `where` fragment.
 *
 * Brand and org are not columns — they are reached through Outlet — so they
 * become nested relation filters rather than flat matches.
 */

/** Roles permitted to see data beyond their own outlet. */
export const GLOBAL_SCOPE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

export function hasGlobalScope(user) {
  return GLOBAL_SCOPE_ROLES.includes(user?.role);
}

/**
 * Sentinel used when a locked role has no resolvable outlet.
 *
 * Returning `{ outletId: undefined }` would be actively dangerous: Prisma drops
 * undefined keys, so the filter would vanish and the query would return every
 * outlet's rows. A uuid column can never equal this string, so the query
 * returns nothing instead. authenticateToken already rejects the tokens that
 * cause this; the sentinel is the second line of defence.
 */
export const MATCH_NOTHING = '__no_outlet__';

/**
 * Scope fragment for models that carry `outletId` directly (Employee, Shift).
 *
 * A user without global scope is pinned to their own outlet and cannot widen
 * that with a query param — the pin is applied instead of, not alongside, the
 * requested scope.
 */
export function outletScope(req) {
  if (!hasGlobalScope(req.user)) {
    return { outletId: req.user.outletId || MATCH_NOTHING };
  }

  const { org, brand, outlet } = req.query;
  if (outlet) return { outletId: outlet };
  if (brand) return { outlet: { brandId: brand } };
  if (org) return { outlet: { brand: { organizationId: org } } };
  return {};
}

/**
 * Same scope for models that reach the outlet through `employee`
 * (Attendance, Leave).
 */
export function employeeScope(req) {
  const scope = outletScope(req);
  return Object.keys(scope).length ? { employee: scope } : {};
}

/**
 * Employee-level filter for "people whose attendance this caller may see".
 *
 * Three narrowings, in one place because every consumer — the attendance list,
 * the weekly/monthly summary and the daily stats — has to agree, or a head
 * reads a percentage whose numerator and denominator count different people.
 *
 * 1. **Outlet**, via outletScope().
 * 2. **Administration roles are excluded.** They belong to no restaurant and
 *    never punch a clock, so their rows are noise in the list and silently
 *    inflate any headcount denominator built from Employee.
 * 3. **A department head sees their own department only** — Head Chef Kitchen,
 *    Master of House Service and Housekeeping. Attendance was the last place a
 *    head could see beyond their own patch, now that shifts, patterns,
 *    enrolment, leave and overtime are all scoped this way. Derived from the
 *    role, never from their own `department` column: a Master of House is
 *    stored as one of the two but owns both, and the signed token carries no
 *    department at all.
 *
 * Returned flat, for use either as an Employee `where` or as the *value* of an
 * `employee` key on Attendance. It must be spread into that nested object
 * rather than alongside it: `{ ...employeeScope(req), employee: {...} }` looks
 * right but overwrites the key employeeScope() put the outlet pin in, and a
 * head chef would then see every outlet in the org.
 */
export function clockingEmployeeFilter(req) {
  const filter = { ...outletScope(req), role: { notIn: GLOBAL_SCOPE_ROLES } };

  // An Outlet Manager runs the whole restaurant, every department in it — the
  // same exemption leave, overtime and shift writes already make.
  if (hasGlobalScope(req.user) || req.user?.role === 'OUTLET_MANAGER') return filter;

  const owned = departmentsFor(req.user?.role);
  if (owned.length) filter.department = { in: owned };

  return filter;
}

/** Standard include for returning an outlet with its brand and org attached. */
export const outletInclude = {
  outlet: {
    include: {
      brand: { include: { organization: true } },
    },
  },
};
