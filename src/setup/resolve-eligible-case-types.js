// @ts-check
import { caseTypeGroupNames, permissions } from '../services/permissions.js';
import {
  displayNameFor,
  loadCaseTypeConfig,
} from '../../case-types/manifest.js';

/**
 * `displayName` is required and comes from THE Case Type registry
 * (`CASE_TYPES`), never from the Case Type config module (#527) — one string
 * composes this type's three SharePoint group names, and the capability side
 * (`permissions.caseTypes`) reads the same copy.
 *
 * @typedef {{
 * slug: string,
 * listName: string,
 * displayName: string,
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
 * Project a resolved Case Type down to the public `CaseSource` shape.
 *
 * @param {{ slug: string, listName: string, displayName: string, maxInProgressCases?: number }} source
 * @returns {CaseSource}
 */
function toCaseSource({ slug, listName, displayName, maxInProgressCases }) {
  return {
    slug,
    listName,
    displayName,
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
 * A Case Type that could not be loaded, and is therefore absent from every
 * resolved source set (#493). `displayName` is for humans only — it falls back
 * to the slug when even the registry lookup failed.
 *
 * @typedef {{ slug: string, displayName: string, error: unknown }} UnavailableCaseType
 */

/**
 * The human label for a slug, for a failure message only. The eligibility path
 * must NEVER use this: it composes SharePoint group names from
 * `displayNameFor()`, and a slug-shaped fallback there would compose group
 * names nobody holds — or, worse, ones somebody does.
 *
 * @param {string} slug
 * @returns {string}
 */
function labelFor(slug) {
  try {
    return displayNameFor(slug);
  } catch {
    return slug;
  }
}

/**
 * Loads and shapes the `CaseTypeSource` for each given slug via its manifest
 * importer, resolving each `listName` in exactly one place.
 *
 * Per-slug containment (#493), the Case Type analogue of `safeRegister` for
 * routes: a Case Type that cannot produce a USABLE source — a module that
 * throws when it is evaluated (a syntax error, an unknown shared General
 * Question key), an invalid outcome config, a config that loads but declares no
 * `listName`, or a slug with no registry display name — is logged, reported and
 * DROPPED, and the remaining Case Types still resolve.
 *
 * "Throws during import" is deliberately not the boundary: a partially-formed
 * config is contained too. The validation therefore happens INSIDE the try, so
 * a dropped Case Type yields no `CaseTypeSource` at all and cannot reach
 * `resolveCaseSourcesFromCaseTypes` in any partial form. Containment can only
 * ever narrow access, never widen it — and a contained Case Type is always
 * NAMED in the boot banner, so the failure surfaces where it happened rather
 * than later as an opaque route error.
 *
 * @param {string[]} slugs
 * @param {Record<string, import('../../case-types/manifest.js').CaseTypeImporter>} importers
 * @param {(failure: UnavailableCaseType) => void} [reportUnavailable]
 * @returns {Promise<{ sources: CaseTypeSource[], unavailable: UnavailableCaseType[] }>}
 */
async function loadCaseTypeSources(
  slugs,
  importers,
  reportUnavailable = ({ slug, error }) =>
    console.error(`[CORA] Case Type "${slug}" failed to load:`, error)
) {
  // Settled per slug first, partitioned second, so both lists stay in the
  // caller's slug order however the imports interleave.
  const settled = await Promise.all(
    slugs.map(async (slug) => {
      try {
        // Through `loadCaseTypeConfig`, not the raw importer, so the outcome
        // configuration is validated here rather than detonating later on the
        // Case Review page.
        //
        // This deliberately *widens* when an invalid outcome config bites, and
        // the trade is worth naming. Before, the Case Type booted and broke
        // only when someone opened one of its Cases; now it is dropped at boot,
        // for every user, and vanishes from every dashboard, list and
        // allocation surface. Wider blast radius for the same defect — but the
        // failure is now contained, announced by name in the boot banner, and
        // fails closed (a dropped Case Type yields no source, so containment
        // can only narrow access). The alternative is a Case Type that looks
        // healthy everywhere except the one page that matters, which is the
        // shape of bug that reaches production and stays there.
        const config = await loadCaseTypeConfig(slug, importers);
        const listName = config.listName;
        if (typeof listName !== 'string' || listName.trim() === '')
          throw new TypeError(
            `Case Type "${slug}" declares no listName. Every Case Type must ` +
              'name the SharePoint list its Cases live on; there is no ' +
              'default store to fall back to (#249).'
          );
        return {
          source: /** @type {CaseTypeSource} */ ({
            slug,
            listName,
            // From THE registry, not from the config module: the capability
            // side derives its group names from the same string (#527).
            displayName: displayNameFor(slug),
            reviewerGroup: config.reviewerGroup,
            config,
          }),
        };
      } catch (error) {
        return {
          failure: /** @type {UnavailableCaseType} */ ({
            slug,
            displayName: labelFor(slug),
            error,
          }),
        };
      }
    })
  );

  const sources = settled.flatMap((result) =>
    result.source ? [result.source] : []
  );
  const unavailable = settled.flatMap((result) =>
    result.failure ? [result.failure] : []
  );
  for (const failure of unavailable) reportUnavailable(failure);

  return { sources, unavailable };
}

/**
 * Pure core of `resolveCaseSources`: which of the given Case Types the user
 * may read from or write to. This is THE app-wide eligibility rule (#370 item
 * 7 / grilling D2). Type-scoped roles grant only their matching source:
 *
 * - `config.reviewerGroup`, if declared
 * - any of `config.eligibleGroups`, if declared
 * - `Reviewers - <displayName>`
 * - `CaseTypeOwner - <displayName>`
 * - `JourneyOwner - <displayName>`
 *
 * where `displayName` is the registry's, and a registered Case Type always has
 * one — so the three derived group names are always contributed (#527).
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
    : caseTypes.filter(({ config, reviewerGroup, displayName }) => {
        // A nameless Case Type contributes NO derived names. `displayName` is
        // required by the typedef and `displayNameFor()` throws before a
        // nameless source can be built, so no production caller reaches this —
        // but this function is exported, and `caseTypeGroupNames(undefined)`
        // would otherwise compose `Reviewers - undefined` and grant a real
        // source to anyone holding that literal group name.
        const derived =
          typeof displayName === 'string' && displayName.trim() !== ''
            ? caseTypeGroupNames(displayName)
            : null;
        const groups = [
          ...(config.eligibleGroups ?? []),
          ...(reviewerGroup ? [reviewerGroup] : []),
          ...(derived
            ? [derived.listAccess, derived.caseTypeOwner, derived.journeyOwner]
            : []),
        ];
        return groups.some((g) => userGroups.includes(g));
      });

  return eligible.map(({ slug, listName, displayName, config }) =>
    toCaseSource({
      slug,
      listName,
      displayName,
      maxInProgressCases: config.maxInProgressCases,
    })
  );
}

/**
 * The ONE seam for the two resolvers below: which importers to load, and where
 * a per-Case-Type failure is reported. Both default to production behaviour —
 * THE registry's importers, and a console error per broken Case Type.
 *
 * `loadCaseTypeSources` is deliberately NOT exported. It was, for tests, which
 * widened the production API with a second way in for no behaviour the
 * `importers` option does not already reach.
 *
 * @typedef {{
 *   importers?: Record<string, import('../../case-types/manifest.js').CaseTypeImporter>,
 *   reportUnavailable?: (failure: UnavailableCaseType) => void
 * }} ResolveOptions
 */

/**
 * Load every Case Type, then apply the app-wide eligibility rule. Case Types
 * that failed to load never reach the rule (#493).
 *
 * @param {string[]} userGroups
 * @param {ResolveOptions} options
 * @returns {Promise<{ caseSources: CaseSource[], unavailableCaseTypes: UnavailableCaseType[] }>}
 */
async function resolveAvailableCaseSources(userGroups, options) {
  const importers =
    options.importers ??
    (await import('../../case-types/manifest.js')).CASE_TYPE_IMPORTERS;

  const { sources, unavailable } = await loadCaseTypeSources(
    Object.keys(importers),
    importers,
    options.reportUnavailable
  );

  return {
    caseSources: resolveCaseSourcesFromCaseTypes(userGroups, sources),
    unavailableCaseTypes: unavailable,
  };
}

/**
 * Resolves every Case source the current user may read from or write to,
 * derived from their group membership. Every slug in `CASE_TYPE_IMPORTERS`
 * (case-types/manifest.js) is considered — eligibility is purely group-derived,
 * never gated by a slug allow-list. Each returned source carries an explicit
 * `listName`: there is no hidden default list to fall back to.
 *
 * A Case Type whose module fails to load is dropped (#493): a user whose only
 * eligible Case Type is broken gets an empty list, never a broken app.
 *
 * @param {string[]} userGroups
 * @param {ResolveOptions} [options]
 * @returns {Promise<CaseSource[]>}
 */
export async function resolveCaseSources(userGroups, options = {}) {
  const { caseSources } = await resolveAvailableCaseSources(
    userGroups,
    options
  );
  return caseSources;
}

/**
 * Resolve the source sets supplied to app routes, plus the Case Types that
 * could not be loaded at all — which boot surfaces once, app-wide, so a
 * mysteriously empty Case list is never mistaken for "no Cases assigned".
 *
 * @param {string[]} userGroups
 * @param {string[]} ownedJourneyCaseTypes
 * @param {ResolveOptions} [options]
 * @returns {Promise<{
 *   caseSources: CaseSource[],
 *   journeyCaseSources: CaseSource[],
 *   unavailableCaseTypes: UnavailableCaseType[]
 * }>}
 */
export async function resolveAppCaseSources(
  userGroups,
  ownedJourneyCaseTypes,
  options = {}
) {
  const { caseSources, unavailableCaseTypes } =
    await resolveAvailableCaseSources(userGroups, options);
  return {
    caseSources,
    journeyCaseSources: caseSources.filter((source) =>
      ownedJourneyCaseTypes.includes(source.slug)
    ),
    unavailableCaseTypes,
  };
}
