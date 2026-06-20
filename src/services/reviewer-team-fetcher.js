// @ts-check
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/**
 * Fan-out: fetches cases for each eligible Case Type filtered by manager ID.
 * Aggregation happens client-side after this call.
 *
 * @param {SharePointClient} client
 * @param {string} managerId
 * @param {string[]} eligibleCaseTypes
 * @returns {Promise<CaseRow[]>}
 */
export async function fetchReviewerTeamCases(
  client,
  managerId,
  eligibleCaseTypes
) {
  const results = await Promise.all(
    eligibleCaseTypes.map((caseType) =>
      client.listCases({ caseType, assignedReviewerManager: managerId })
    )
  );
  return results.flat();
}
