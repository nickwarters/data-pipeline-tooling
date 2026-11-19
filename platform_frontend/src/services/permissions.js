// @ts-check
/**
 * Resolves what the current user may do in CORA from their `CoraUserRoles`
 * row, and names the groups that only open Case lists. A person's roles are
 * their row; the one role still held in a group is the Maintainer, because
 * `CORA Owner Delegates` owns every other group and edits the row, so it
 * cannot live inside it. Add new Case Types in `case-types/manifest.js`, from
 * which `permissions.caseTypes` is derived.
 *
 * @typedef {{ slug: string, displayName: string }} CaseTypeGroupSource
 *
 * @typedef {{
 * maintainer: string,
 * caseTypes: CaseTypeGroupSource[]
 * }} PermissionsConfig
 */

import { CASE_TYPES } from '../../case-types/manifest.js';
import { noRoles } from './user-roles.js';

/**
 * Resolved capabilities for the current user, derived from their roles row.
 * `isReviewer` is implied by reviewing any Case Type as well as by the row's
 * bare Reviewer flag. `isVisitor` is DERIVED (not config-driven): true iff the
 * user holds no capability at all.
 *
 * These are platform-wide and per-user. They are not the per-Case roles the
 * Case page's access matrix is keyed by, and only some of them ever become
 * one: `resolveRoles` in `section-access.js` is the single translation point,
 * and it documents which capabilities it reads, which it deliberately ignores,
 * and which roles come off the Case row instead of the roles row.
 *
 * @typedef {{
 * isReviewer: boolean,
 * listAccessCaseTypes: string[],
 * isAdviser: boolean,
 * ownedCaseTypes: string[],
 * ownedJourneyCaseTypes: string[],
 * isControls: boolean,
 * isReviewerManager: boolean,
 * isResponsiblePartyManager: boolean,
 * isMaintainer: boolean,
 * canSearchCases: boolean,
 * canChangeOutcome: boolean,
 * isVisitor: boolean
 * }} Capabilities
 */

/**
 * The two groups that open one Case Type's list: `read` holds Read, and
 * `write` holds `CORA Contribute (no delete)`. They are access only — what a
 * member may do there is their `CoraUserRoles` row.
 *
 * @param {string} displayName
 * @returns {{ read: string, write: string }}
 */
export function caseListGroupNames(displayName) {
  return {
    read: `Cases - ${displayName} Read`,
    write: `Cases - ${displayName} Write`,
  };
}

/**
 * The two groups that open every Case list at once, for the roles that work
 * across all Case Types: `read` holds Read and `write` holds `CORA Contribute
 * (no delete)` on each list.
 */
export const allCaseListGroups = Object.freeze({
  read: 'CORA All Cases Read',
  write: 'CORA All Cases Write',
});

/** @type {PermissionsConfig} */
export const permissions = {
  maintainer: 'CORA Owner Delegates',
  // The Case Types a row's per-type columns may name. Projected from THE Case
  // Type registry (case-types/manifest.js) so adding a Case Type is one
  // registry edit. That registry holds importer *thunks* only, so reading it
  // here stays synchronous and evaluates no Case Type module — capability
  // resolution remains boot-critical and lazy.
  //
  // Derived ON READ, not snapshotted at module scope. A snapshot was
  // taken the moment this module was first evaluated, so any Case Type
  // registered afterwards was invisible here while `resolveAppCaseSources()` —
  // which reads the registry live through `displayNameFor()` — already granted
  // it. The two sides then disagreed about the same user depending on nothing
  // but module-evaluation order: the capability layer called them a Visitor
  // with no role at all, while the eligibility layer handed them a Case source.
  // A getter keeps the single source of truth single at every point in time.
  get caseTypes() {
    return CASE_TYPES.map(({ slug, displayName }) => ({ slug, displayName }));
  },
};

/**
 * Resolve a user's `CoraUserRoles` row, and their membership of the Maintainer
 * group, into concrete capabilities. UX-only — SharePoint list ACLs are the
 * real boundary. A slug in the row that names no Case Type this application
 * has grants nothing.
 *
 * @param {string[]} userGroups
 * @param {PermissionsConfig} [config]
 * @param {import('./user-roles.js').UserRoles} [userRoles]
 * @returns {Capabilities}
 */
export function resolveCapabilities(
  userGroups,
  config = permissions,
  userRoles = noRoles()
) {
  const slugs = config.caseTypes.map(({ slug }) => slug);
  const known = (/** @type {readonly string[]} */ held) =>
    slugs.filter((slug) => held.includes(slug));

  const listAccessCaseTypes = known(userRoles.reviews);
  const ownedCaseTypes = known(userRoles.ownsCaseTypes);
  const ownedJourneyCaseTypes = known(userRoles.journeyOwnerOf);

  // Reviewing a Case Type implies the reviewing function.
  const isReviewer = userRoles.reviewer || listAccessCaseTypes.length > 0;
  const isAdviser = userRoles.adviser;
  const isControls = userRoles.controls;
  const isReviewerManager = userRoles.reviewerManager;
  const isResponsiblePartyManager = userRoles.responsiblePartyManager;
  const isMaintainer = userGroups.includes(config.maintainer);
  // Controls can do both; the row's permission columns give one of them to
  // somebody without the rest of Controls.
  const canSearchCases = isControls || userRoles.canSearchCases;
  const canChangeOutcome = isControls || userRoles.canChangeOutcome;
  const isVisitor =
    !isReviewer &&
    !canSearchCases &&
    !canChangeOutcome &&
    !isAdviser &&
    !isControls &&
    !isReviewerManager &&
    !isResponsiblePartyManager &&
    !isMaintainer &&
    ownedCaseTypes.length === 0 &&
    ownedJourneyCaseTypes.length === 0;

  return {
    isReviewer,
    listAccessCaseTypes,
    isAdviser,
    ownedCaseTypes,
    ownedJourneyCaseTypes,
    isControls,
    isReviewerManager,
    isResponsiblePartyManager,
    isMaintainer,
    canSearchCases,
    canChangeOutcome,
    isVisitor,
  };
}
