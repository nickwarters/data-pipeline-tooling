// @ts-check
import { listCasesAcrossSources } from './across-sources.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('./team-cases-params.js').TeamCasesParams} TeamCasesParams */
/** @typedef {import('../setup/resolve-eligible-case-types.js').CaseSource} CaseSource */

/**
 * Fan-out fetch across one or more Case Type lists, scoped by manager and
 * params. Each Case lives in exactly one list (`source.listName`), so every
 * `listCases` call carries an explicit `{ listName }` and the per-list rows
 * are merged client-side.
 *
 * @param {SharePointClient} client
 * @param {TeamCasesParams} params
 * @param {string} managerId
 * @param {CaseSource[]} sources
 * @returns {Promise<CaseRow[]>}
 */
export function fetchTeamCases(client, params, managerId, sources) {
  const targets = params.caseType
    ? sources.filter((s) => s.slug === params.caseType)
    : sources;

  return listCasesAcrossSources(client, targets, (target) => ({
    caseType: target.slug,
    assignedReviewerManager: managerId,
  }));
}
