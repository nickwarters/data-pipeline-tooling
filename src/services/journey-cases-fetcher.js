// @ts-check
import { listCasesAcrossSources } from './across-sources.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../setup/resolve-eligible-case-types.js').CaseSource} CaseSource */

/**
 * Journey Owner's cross-case reach: fan out across every Case
 * Type list the user owns as a Journey Owner (`journeySources`), one bounded
 * server-side `$filter` per Case Type list — each carrying an explicit
 * `{ listName }`, since a Case lives in exactly one list — and merge the
 * rows. This is a *list-scope* capability beyond the per-Case access matrix —
 * a Journey Owner sees the Summary of every Case of their type(s).
 *
 * @param {SharePointClient} client
 * @param {CaseSource[]} journeySources
 * @returns {Promise<CaseRow[]>}
 */
export function fetchJourneyCases(client, journeySources) {
  return listCasesAcrossSources(client, journeySources, (source) => ({
    caseType: source.slug,
  }));
}
