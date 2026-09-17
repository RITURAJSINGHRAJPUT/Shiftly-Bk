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
 * Two narrowings, in one place because every consumer — the attendance list,
 * the weekly/monthly summary and the daily stats — has to agree, or a head
 * reads a percentage whose numerator and denominator count different people.
 *
 * 1. **Outlet**, via outletScope(). A Master of House or Head Chef sees every
 *    department at their own restaurant — they run the floor and the kitchen
 *    side by side and need to see who is in. What they may *approve* is still
 *    their own department only; that is overtimeApprovalDenied()'s rule, not
 *    this one.
 * 2. **Administration roles are excluded.** They belong to no restaurant and
 *    never punch a clock, so their rows are noise in the list and silently
 *    inflate any headcount denominator built from Employee.
 *
 * Returned flat, for use either as an Employee `where` or as the *value* of an
 * `employee` key on Attendance. It must be spread into that nested object
 * rather than alongside it: `{ ...employeeScope(req), employee: {...} }` looks
 * right but overwrites the key employeeScope() put the outlet pin in, and a
 * head chef would then see every outlet in the org.
 */
export function clockingEmployeeFilter(req) {
  return { ...outletScope(req), role: { notIn: GLOBAL_SCOPE_ROLES } };
}

/** Standard include for returning an outlet with its brand and org attached. */
export const outletInclude = {
  outlet: {
    include: {
      brand: { include: { organization: true } },
    },
  },
};
