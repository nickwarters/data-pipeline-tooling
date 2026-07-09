// @ts-check
/**
 * @typedef {{
 * slug: string,
 * listName: string,
 * reviewerGroup?: string,
 * config: import('../sharepoint-client.js').CaseTypeConfig
 * }} CaseTypeSource
 */

/**
 * @param {string[]} userGroups
 * @param {CaseTypeSource[]} caseTypes
 * @returns {CaseTypeSource[]}
 */
export function resolveEligibleCaseSourcesFromCaseTypes(userGroups, caseTypes) {
  // Reviewer Managers need all case types for fan-out reporting queries.
  if (userGroups.includes('Reviewer-Managers')) {
    return caseTypes;
  }

  return caseTypes.filter(({ config, reviewerGroup }) => {
    const groups = [
      ...(config.eligibleGroups ?? []),
      ...(reviewerGroup ? [reviewerGroup] : []),
    ];
    return groups.some((g) => userGroups.includes(g));
  });
}

/**
 * @param {string[]} userGroups
 * @returns {Promise<string[]>}
 */
export async function resolveEligibleCaseTypes(userGroups) {
  const { default: exampleReviewConfig } =
    await import('../../case-types/example-review.js');

  /** @type {CaseTypeSource[]} */
  const caseTypes = [
    {
      slug: 'example-review',
      listName: exampleReviewConfig.listName ?? 'Cases-ExampleReview',
      reviewerGroup: exampleReviewConfig.reviewerGroup,
      config: exampleReviewConfig,
    },
  ];

  return resolveEligibleCaseSourcesFromCaseTypes(userGroups, caseTypes).map(
    ({ slug }) => slug
  );
}
