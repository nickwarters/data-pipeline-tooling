// @ts-check

import { resolveAppCaseSources } from '../src/setup/resolve-eligible-case-types.js';
import {
  isRoleEntry,
  noRoles,
  withRoleEntries,
} from '../src/services/user-roles.js';

/**
 * A person's access spelled as one list, the way the Access page plans it:
 * groups and `CoraUserRoles` role entries side by side. Returns the groups and
 * the roles row they make, so a test can say "a Reviewer of Complaints" as
 * `['CoraUserRoles: Reviews = complaints']`.
 *
 * @param {readonly string[]} held
 * @returns {{ groups: string[], roles: import('../src/services/user-roles.js').UserRoles }}
 */
export function holding(held) {
  return {
    groups: held.filter((part) => !isRoleEntry(part)),
    roles: withRoleEntries(noRoles(), { add: held.filter(isRoleEntry) }),
  };
}

/**
 * A test-local convenience over the live `resolveAppCaseSources`, and nothing
 * the application itself calls: it returns the Case-source half, which is all
 * the suites reaching for this are about, and no route in them owns a Journey
 * Case Type, so the second argument is always empty.
 *
 * @param {readonly string[]} held groups and role entries, as `holding` reads them
 * @param {Parameters<typeof resolveAppCaseSources>[2]} [options]
 * @returns {Promise<Awaited<ReturnType<typeof resolveAppCaseSources>>['caseSources']>}
 */
export async function caseSourcesFor(held, options) {
  const { groups, roles } = holding(held);
  return (
    await resolveAppCaseSources(groups, [], { userRoles: roles, ...options })
  ).caseSources;
}
