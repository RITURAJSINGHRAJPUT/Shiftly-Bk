/**
 * Which manager owns which department.
 *
 * One table, three consumers: leave approval, overtime approval, and enrolment.
 * It was declared separately in each of the first two before this existed, and
 * a third copy was the point at which they would have drifted.
 *
 * Note this is a property of the **role**, not of the manager's own department
 * row. A Master of House is stored with `department: SERVICE` yet owns
 * HOUSEKEEPING as well — and the signed token carries no department at all
 * (`{ v, id, role, outletId }`), so deriving it from the role is both the only
 * option and the correct one.
 */

/** Who, besides HR/ADMIN/SUPER_ADMIN, owns each department. */
export const DEPARTMENT_APPROVERS = {
  KITCHEN: 'HEAD_CHEF',
  SERVICE: 'MASTER_OF_HOUSE',
  HOUSEKEEPING: 'MASTER_OF_HOUSE',
};

/**
 * The inverse: the departments a role owns.
 *
 * What enrolment needs — "which departments may this manager put someone in" —
 * where approval needs the forward lookup. Returns [] for a role that owns
 * none, which is every role that is not a department head.
 */
export function departmentsFor(role) {
  return Object.entries(DEPARTMENT_APPROVERS)
    .filter(([, owner]) => owner === role)
    .map(([department]) => department);
}

/** Whether `role` owns `department`. False for an unknown or missing department. */
export function ownsDepartment(role, department) {
  return Boolean(department) && DEPARTMENT_APPROVERS[department] === role;
}
