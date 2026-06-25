// @ts-check

/**
 * @param {string[]} userGroups
 * @returns {Promise<string[]>}
 */
export async function resolveEligibleCaseTypes(userGroups) {
  const { default: exampleReviewConfig } =
    await import('../../case-types/example-review.js');

  /** @type {Array<{ slug: string, config: import('../sharepoint-client.js').CaseTypeConfig }>} */
  const caseTypes = [{ slug: 'example-review', config: exampleReviewConfig }];

  // Reviewer Managers need all case types for fan-out reporting queries.
  if (userGroups.includes('Reviewer-Managers')) {
    return caseTypes.map(({ slug }) => slug);
  }

  return caseTypes
    .filter(({ config }) =>
      config.eligibleGroups?.some((g) => userGroups.includes(g))
    )
    .map(({ slug }) => slug);
}
