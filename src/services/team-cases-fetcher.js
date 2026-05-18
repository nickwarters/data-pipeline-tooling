// @ts-check
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('./team-cases-params.js').TeamCasesParams} TeamCasesParams */

/**
 * Fan-out fetch across one or more Case Type lists, scoped by manager and params.
 *
 * @param {SharePointClient} client
 * @param {TeamCasesParams} params
 * @param {string} managerId
 * @param {string[]} eligibleCaseTypes
 * @returns {Promise<CaseRow[]>}
 */
export async function fetchTeamCases(client, params, managerId, eligibleCaseTypes) {
  const targets = params.caseType ? [params.caseType] : eligibleCaseTypes;

  const results = await Promise.all(
    targets.map(caseType => client.listCases({ caseType, assignedReviewerManager: managerId })),
  );
  return results.flat();
}
