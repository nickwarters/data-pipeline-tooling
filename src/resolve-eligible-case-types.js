// @ts-check

/**
 * @param {string[]} userGroups
 * @returns {Promise<string[]>}
 */
export async function resolveEligibleCaseTypes(userGroups) {
  const { default: helloReviewConfig } = await import('../case-types/hello-review.js');

  /** @type {Array<{ slug: string, config: import('./sharepoint-client.js').CaseTypeConfig }>} */
  const caseTypes = [
    { slug: 'hello-review', config: helloReviewConfig },
  ];

  return caseTypes
    .filter(({ config }) => config.eligibleGroups?.some(g => userGroups.includes(g)))
    .map(({ slug }) => slug);
}
