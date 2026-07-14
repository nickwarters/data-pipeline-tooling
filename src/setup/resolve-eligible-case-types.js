// @ts-check
import { caseTypeGroupNames } from '../services/permissions.js';

/**
 * @typedef {{
 * slug: string,
 * listName: string,
 * reviewerGroup?: string,
 * config: import('../sharepoint-client.js').CaseTypeConfig
 * }} CaseTypeSource
 */

/**
 * An allocation source: one Case Type queue "Request next Case" can draw
 * from, resolved from the user's group membership. `listName` is the
 * SharePoint list to query — always resolved explicitly (declared
 * `config.listName`, or the `Cases-{PascalSlug}` naming convention) so
 * "Request next Case" never falls back to a hidden default list.
 *
 * @typedef {{ slug: string, listName: string }} AllocationSource
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
 * Loads and shapes the `CaseTypeSource` for each given slug via its
 * manifest importer. Shared by `resolveEligibleCaseTypes` (scoped to
 * `DASHBOARD_ENABLED_SLUGS`) and `resolveAllocationSources` (every manifest
 * slug) so the `listName` resolution rule lives in exactly one place.
 *
 * @param {string[]} slugs
 * @param {Record<string, import('../../case-types/manifest.js').CaseTypeImporter>} importers
 * @returns {Promise<CaseTypeSource[]>}
 */
async function loadCaseTypeSources(slugs, importers) {
  return Promise.all(
    slugs.map(async (slug) => {
      const { default: config } = await importers[slug]();
      return /** @type {CaseTypeSource} */ ({
        slug,
        listName: config.listName ?? defaultListNameForSlug(slug),
        reviewerGroup: config.reviewerGroup,
        config,
      });
    })
  );
}

/**
 * @param {string[]} userGroups
 * @returns {Promise<string[]>}
 */
export async function resolveEligibleCaseTypes(userGroups) {
  const { CASE_TYPE_IMPORTERS } = await import('../../case-types/manifest.js');

  const caseTypes = await loadCaseTypeSources(
    DASHBOARD_ENABLED_SLUGS,
    CASE_TYPE_IMPORTERS
  );

  return resolveEligibleCaseSourcesFromCaseTypes(userGroups, caseTypes).map(
    ({ slug }) => slug
  );
}

/**
 * Pure core of `resolveAllocationSources`: which of the given Case Types the
 * user may draw a "Request next Case" allocation from, given every group a
 * Case Type can grant access through:
 *
 * - `config.reviewerGroup`, if declared
 * - any of `config.eligibleGroups`, if declared
 * - the per-Case-Type list-access group (`Reviewers - <config.displayName>`,
 *   from `caseTypeGroupNames`), if the config declares a `displayName`
 *
 * Unlike `resolveEligibleCaseSourcesFromCaseTypes` (which is scoped to
 * `DASHBOARD_ENABLED_SLUGS`), this is meant to run over every Case Type in
 * the manifest — allocation is not gated by dashboard readiness.
 *
 * Reviewer-Managers mirrors `resolveEligibleCaseSourcesFromCaseTypes`: they
 * need every Case Type for fan-out reporting/allocation, regardless of its
 * own group configuration.
 *
 * @param {string[]} userGroups
 * @param {CaseTypeSource[]} caseTypes
 * @returns {AllocationSource[]}
 */
export function resolveAllocationSourcesFromCaseTypes(userGroups, caseTypes) {
  const eligible = userGroups.includes('Reviewer-Managers')
    ? caseTypes
    : caseTypes.filter(({ config, reviewerGroup }) => {
        const groups = [
          ...(config.eligibleGroups ?? []),
          ...(reviewerGroup ? [reviewerGroup] : []),
          ...(config.displayName
            ? [caseTypeGroupNames(config.displayName).listAccess]
            : []),
        ];
        return groups.some((g) => userGroups.includes(g));
      });

  return eligible.map(({ slug, listName }) => ({ slug, listName }));
}

/**
 * Resolves the Case Type sources "Request next Case" may allocate from,
 * derived from the user's group membership. Every slug in
 * `CASE_TYPE_IMPORTERS` (case-types/manifest.js) is considered — allocation
 * is not gated by `DASHBOARD_ENABLED_SLUGS`. Each returned source carries an
 * explicit `listName`, resolved from the Case Type's declared `listName` or
 * the `Cases-{PascalSlug}` naming convention: there is no hidden default
 * list to fall back to.
 *
 * @param {string[]} userGroups
 * @returns {Promise<AllocationSource[]>}
 */
export async function resolveAllocationSources(userGroups) {
  const { CASE_TYPE_IMPORTERS } = await import('../../case-types/manifest.js');

  const caseTypes = await loadCaseTypeSources(
    Object.keys(CASE_TYPE_IMPORTERS),
    CASE_TYPE_IMPORTERS
  );

  return resolveAllocationSourcesFromCaseTypes(userGroups, caseTypes);
}
