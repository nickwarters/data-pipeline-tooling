// @ts-check
// TODO(simplify-ui): Keep service access as explicit plain dependencies
// passed into route shells/function components. The simplified UI should not
// require component authors to understand service classes, global singletons,
// or lifecycle wiring to perform ordinary reads and writes.

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
