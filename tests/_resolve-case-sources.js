// @ts-check

import { resolveAppCaseSources } from '../src/setup/resolve-eligible-case-types.js';

/**
 * The Case-source half of `resolveAppCaseSources`, which is all the suites
 * reaching for this are about: no route in them owns a Journey Case Type, so
 * the second argument is always empty.
 *
 * @param {string[]} userGroups
 * @param {Parameters<typeof resolveAppCaseSources>[2]} [options]
 * @returns {Promise<Awaited<ReturnType<typeof resolveAppCaseSources>>['caseSources']>}
 */
export async function resolveCaseSources(userGroups, options) {
  return (await resolveAppCaseSources(userGroups, [], options)).caseSources;
}
