// @ts-check
import { caseTypeGroupNames } from '../services/permissions.js';

/**
 * @typedef {{
 * slug: string,
 * listName: string,
 * displayName?: string,
 * reviewerGroup?: string,
 * config: import('../sharepoint-client.js').CaseTypeConfig
 * }} CaseTypeSource
 */

/**
 * A Case source the current user may read from or write to, resolved from
 * their group membership (the app-wide eligibility rule). `listName` is the
 * SharePoint list to query — always declared explicitly as `config.listName`
 * so no read/write ever falls back to a hidden default list. `displayName` is the
 * Case Type's human name, carried so per-source consumers (dashboards,
 * fetchers) need not re-resolve it.
 *
 * @typedef {{ slug: string, listName: string, displayName: string }} CaseSource
 */

/**
 * The `{ slug, listName }` shape `cora-allocation` tags each drawn Case with,
 * so the later write lands on the same list the row was read from. Structurally
 * a `CaseSource` without the display name.
 *
 * @typedef {{ slug: string, listName: string }} AllocationSource
 */

/**
 * Project a resolved Case Type down to the public `CaseSource` shape, coercing
 * an absent display name to an empty string in exactly one place.
 *
 * @param {{ slug: string, listName: string, displayName?: string }} source
 * @returns {CaseSource}
 */
function toCaseSource({ slug, listName, displayName }) {
  return { slug, listName, displayName: displayName ?? '' };
}

/**
 * Loads and shapes the `CaseTypeSource` for each given slug via its manifest
 * importer, resolving each `listName` in exactly one place.
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
        listName: /** @type {string} */ (config.listName),
        displayName: config.displayName,
        reviewerGroup: config.reviewerGroup,
        config,
      });
    })
  );
}

/**
 * Pure core of `resolveCaseSources`: which of the given Case Types the user
 * may read from or write to. This is THE app-wide eligibility rule (#370 item
 * 7 / grilling D2). Type-scoped roles grant only their matching source:
 *
 * - `config.reviewerGroup`, if declared
 * - any of `config.eligibleGroups`, if declared
 * - `Reviewers - <config.displayName>`
 * - `CaseTypeOwner - <config.displayName>`
 * - `JourneyOwner - <config.displayName>`
 *
 * Controls, Reviewer-Managers, Advisers and ResponsibleParty-Managers span
 * every source. Adviser and manager consumers must still apply their
 * assignment filter to each per-list query. Configured `eligibleGroups` and
 * `reviewerGroup` remain aliases for a type's access groups.
 *
 * @param {string[]} userGroups
 * @param {CaseTypeSource[]} caseTypes
 * @returns {CaseSource[]}
 */
export function resolveCaseSourcesFromCaseTypes(userGroups, caseTypes) {
  const eligible = userGroups.some((group) =>
    [
      'Reviewer-Managers',
      'Controls',
      'Advisers',
      'ResponsibleParty-Managers',
    ].includes(group)
  )
    ? caseTypes
    : caseTypes.filter(({ config, reviewerGroup }) => {
        const groups = [
          ...(config.eligibleGroups ?? []),
          ...(reviewerGroup ? [reviewerGroup] : []),
          ...(config.displayName
            ? [
                caseTypeGroupNames(config.displayName).listAccess,
                caseTypeGroupNames(config.displayName).caseTypeOwner,
                caseTypeGroupNames(config.displayName).journeyOwner,
              ]
            : []),
        ];
        return groups.some((g) => userGroups.includes(g));
      });

  return eligible.map(({ slug, listName, config }) =>
    toCaseSource({ slug, listName, displayName: config.displayName })
  );
}

/**
 * Resolves every Case source the current user may read from or write to,
 * derived from their group membership. Every slug in `CASE_TYPE_IMPORTERS`
 * (case-types/manifest.js) is considered — eligibility is purely group-derived,
 * never gated by a slug allow-list. Each returned source carries an explicit
 * `listName`: there is no hidden default list to fall back to.
 *
 * @param {string[]} userGroups
 * @returns {Promise<CaseSource[]>}
 */
export async function resolveCaseSources(userGroups) {
  const { CASE_TYPE_IMPORTERS } = await import('../../case-types/manifest.js');

  const caseTypes = await loadCaseTypeSources(
    Object.keys(CASE_TYPE_IMPORTERS),
    CASE_TYPE_IMPORTERS
  );

  return resolveCaseSourcesFromCaseTypes(userGroups, caseTypes);
}

/**
 * Resolve the source sets supplied to app routes. The compatibility name
 * `allCaseSources` means "all sources this user may span", never the whole
 * manifest for a type-scoped role.
 *
 * @param {string[]} userGroups
 * @param {string[]} ownedJourneyCaseTypes
 * @returns {Promise<{
 *   caseSources: CaseSource[],
 *   allCaseSources: CaseSource[],
 *   journeyCaseSources: CaseSource[]
 * }>}
 */
export async function resolveAppCaseSources(userGroups, ownedJourneyCaseTypes) {
  const caseSources = await resolveCaseSources(userGroups);
  return {
    caseSources,
    allCaseSources: caseSources,
    journeyCaseSources: caseSources.filter((source) =>
      ownedJourneyCaseTypes.includes(source.slug)
    ),
  };
}

/**
 * Every Case Type in the manifest as an explicit source, independent of
 * eligibility. This low-level utility is not used to populate app routes;
 * `resolveAppCaseSources` supplies their role-authorized source set.
 *
 * @returns {Promise<CaseSource[]>}
 */
export async function resolveAllCaseSources() {
  const { CASE_TYPE_IMPORTERS } = await import('../../case-types/manifest.js');

  return resolveSourcesForSlugs(Object.keys(CASE_TYPE_IMPORTERS));
}

/**
 * Resolve explicit `{ slug, listName, displayName }` sources for an arbitrary
 * set of manifest slugs, independent of the eligibility rule. Used where the
 * relevant slugs come from a different axis than group-derived eligibility —
 * e.g. a Journey Owner's `ownedJourneyCaseTypes`, which a pure Journey Owner
 * holds without any reviewer/list-access group, so they never appear in
 * `resolveCaseSources`.
 *
 * @param {string[]} slugs
 * @returns {Promise<CaseSource[]>}
 */
export async function resolveSourcesForSlugs(slugs) {
  const { CASE_TYPE_IMPORTERS } = await import('../../case-types/manifest.js');

  const caseTypes = await loadCaseTypeSources(slugs, CASE_TYPE_IMPORTERS);

  return caseTypes.map(toCaseSource);
}
