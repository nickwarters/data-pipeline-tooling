// @ts-check

import { resolveAppCaseSources } from '../src/setup/resolve-eligible-case-types.js';

/**
 * A test-local convenience over the live `resolveAppCaseSources`, and nothing
 * the application itself calls: it returns the Case-source half, which is all
 * the suites reaching for this are about, and no route in them owns a Journey
 * Case Type, so the second argument is always empty.
 *
 * @param {string[]} userGroups
 * @param {Parameters<typeof resolveAppCaseSources>[2]} [options]
 * @returns {Promise<Awaited<ReturnType<typeof resolveAppCaseSources>>['caseSources']>}
 */
export async function caseSourcesFor(userGroups, options) {
  return (await resolveAppCaseSources(userGroups, [], options)).caseSources;
}
