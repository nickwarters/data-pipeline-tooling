// @ts-check
import { caseTypeGroupNames, permissions } from '../services/permissions.js';

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
 * @typedef {{ slug: string, listName: string, displayName: string, maxInProgressCases?: number }} CaseSource
 */

/**
 * The `{ slug, listName }` shape `cora-allocation` tags each drawn Case with,
 * so the later write lands on the same list the row was read from. Structurally
 * a `CaseSource` without the display name.
 *
 * @typedef {{ slug: string, listName: string, maxInProgressCases?: number }} AllocationSource
 */

/**
 * Project a resolved Case Type down to the public `CaseSource` shape, coercing
 * an absent display name to an empty string in exactly one place.
 *
 * @param {{ slug: string, listName: string, displayName?: string, maxInProgressCases?: number }} source
 * @returns {CaseSource}
 */
function toCaseSource({ slug, listName, displayName, maxInProgressCases }) {
  return {
    slug,
    listName,
    displayName: displayName ?? '',
    ...(maxInProgressCases === undefined ? {} : { maxInProgressCases }),
  };
}

/**
 * Projects app-wide Case sources down to allocation sources. A malformed limit
 * disables allocation only for that Case Type: the source remains available to
 * the rest of the app and the other Case Types continue to allocate.
 *
 * @param {CaseSource[]} caseSources
 * @param {(error: TypeError) => void} [reportInvalid]
 * @returns {AllocationSource[]}
 */
export function allocationSourcesFromCaseSources(
  caseSources,
  reportInvalid = (error) =>
    console.error('[RALPH] Allocation source disabled:', error)
) {
  return caseSources.flatMap(({ slug, listName, maxInProgressCases }) => {
    if (
      maxInProgressCases !== undefined &&
      (!Number.isInteger(maxInProgressCases) || maxInProgressCases <= 0)
    ) {
      reportInvalid(
        new TypeError(
          `Case Type "${slug}" maxInProgressCases must be a positive integer.`
        )
      );
      return [];
    }
    return [
      {
        slug,
        listName,
        ...(maxInProgressCases === undefined ? {} : { maxInProgressCases }),
      },
    ];
  });
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
 * Controls, Reviewer Managers, Advisers, ResponsibleParty-Managers and
 * Maintainers span
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
      permissions.reviewerManager,
      permissions.controls,
      permissions.adviser,
      permissions.responsiblePartyManager,
      permissions.maintainer,
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
    toCaseSource({
      slug,
      listName,
      displayName: config.displayName,
      maxInProgressCases: config.maxInProgressCases,
    })
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
 * Resolve the source sets supplied to app routes.
 *
 * @param {string[]} userGroups
 * @param {string[]} ownedJourneyCaseTypes
 * @returns {Promise<{
 *   caseSources: CaseSource[],
 *   journeyCaseSources: CaseSource[]
 * }>}
 */
export async function resolveAppCaseSources(userGroups, ownedJourneyCaseTypes) {
  const caseSources = await resolveCaseSources(userGroups);
  return {
    caseSources,
    journeyCaseSources: caseSources.filter((source) =>
      ownedJourneyCaseTypes.includes(source.slug)
    ),
  };
}
