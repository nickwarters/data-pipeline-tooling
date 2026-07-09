// @ts-check
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/**
 * Journey Owner's cross-case reach: fan out across every Case
 * Type the user owns as a Journey Owner (`ownedJourneyCaseTypes`), one bounded
 * server-side `$filter` per Case Type list, and merge the rows. This is a
 * *list-scope* capability beyond the per-Case access matrix — a Journey Owner
 * sees the Summary of every Case of their type(s).
 *
 * @param {SharePointClient} client
 * @param {string[]} ownedJourneyCaseTypes
 * @returns {Promise<CaseRow[]>}
 */
export async function fetchJourneyCases(client, ownedJourneyCaseTypes) {
  const results = await Promise.all(
    ownedJourneyCaseTypes.map((caseType) => client.listCases({ caseType }))
  );
  return results.flat();
}
