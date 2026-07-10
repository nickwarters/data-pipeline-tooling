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
 * Case Types shown on dashboards (#/dashboard, #/team-cases,
 * #/reports/reviewer-team). Every slug in `CASE_TYPE_IMPORTERS`
 * (case-types/manifest.js) is URL-openable via `#/case/:caseType/:id`;
 * dashboard visibility is a separate, deliberate decision, tracked here.
 *
 * Enabling a Case Type for dashboards is adding its slug to this array —
 * `resolveEligibleCaseTypes` derives everything else from it.
 *
 * Slugs present in the manifest but NOT yet listed here (see
 * tests/case-type-eligibility-consistency.test.js for the current set and
 * why each one is staged, not an oversight):
 * - `product-sale-review` — Slice 8 "first real Case Type" is still rolling
 *   out; not yet ready for dashboard-driven queue/allocation flows.
 * - `stress-review` — a perf/hardening harness (see
 *   case-types/stress-review.js: "Not a production Case Type"), never meant
 *   to reach a dashboard.
 * - `complaints` — deliberately mock-only until list-backed Case Types are
 *   wired into the mock client (see case-types/complaints.js); premature on
 *   dashboards that assume list-backed querying.
 *
 * @type {string[]}
 */
export const DASHBOARD_ENABLED_SLUGS = ['example-review'];

/**
 * Kebab-case slug -> PascalCase, matching the `Cases-{PascalSlug}`
 * SharePoint list naming convention (e.g. `example-review` ->
 * `Cases-ExampleReview`). Used only as a fallback when a Case Type config
 * doesn't declare its own `listName`.
 *
 * @param {string} slug
 * @returns {string}
 */
function defaultListNameForSlug(slug) {
  const pascal = slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return `Cases-${pascal}`;
}

/**
 * @param {string[]} userGroups
 * @returns {Promise<string[]>}
 */
export async function resolveEligibleCaseTypes(userGroups) {
  const { CASE_TYPE_IMPORTERS } = await import('../../case-types/manifest.js');

  const caseTypes = await Promise.all(
    DASHBOARD_ENABLED_SLUGS.map(async (slug) => {
      const { default: config } = await CASE_TYPE_IMPORTERS[slug]();
      return /** @type {CaseTypeSource} */ ({
        slug,
        listName: config.listName ?? defaultListNameForSlug(slug),
        reviewerGroup: config.reviewerGroup,
        config,
      });
    })
  );

  return resolveEligibleCaseSourcesFromCaseTypes(userGroups, caseTypes).map(
    ({ slug }) => slug
  );
}
