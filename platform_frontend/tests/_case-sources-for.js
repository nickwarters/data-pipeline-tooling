// @ts-check

import { resolveAppCaseSources } from '../src/setup/resolve-eligible-case-types.js';

/**
 * A test-local convenience over the live `resolveAppCaseSources`, and nothing
 * the application itself calls: it returns the Case-source half, which is all
 * the suites reaching for this are about, and no route in them owns a Journey
 * Case Type or sits in a frontline team, so both scopes are always empty.
 *
 * @param {string[]} userGroups
 * @param {Parameters<typeof resolveAppCaseSources>[2]} [options]
 * @returns {Promise<Awaited<ReturnType<typeof resolveAppCaseSources>>['caseSources']>}
 */
export async function caseSourcesFor(userGroups, options) {
  return (
    await resolveAppCaseSources(
      userGroups,
      { ownedJourneyCaseTypes: [], frontlineTeamCaseTypes: [] },
      options
    )
  ).caseSources;
}
