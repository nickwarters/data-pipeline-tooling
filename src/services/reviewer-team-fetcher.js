// @ts-check
import { listCasesAcrossSources } from './across-sources.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../setup/resolve-eligible-case-types.js').CaseSource} CaseSource */

/**
 * Fan-out: fetches cases for each eligible Case Type list, filtered by
 * manager ID. Each Case lives in exactly one list (`source.listName`), so
 * every call carries an explicit `{ listName }`. Aggregation happens
 * client-side after this call.
 *
 * @param {SharePointClient} client
 * @param {string} managerId
 * @param {CaseSource[]} sources
 * @returns {Promise<CaseRow[]>}
 */
export function fetchReviewerTeamCases(client, managerId, sources) {
  return listCasesAcrossSources(client, sources, (source) => ({
    caseType: source.slug,
    assignedReviewerManager: managerId,
  }));
}
