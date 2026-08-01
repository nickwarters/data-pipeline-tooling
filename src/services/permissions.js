// @ts-check
/**
 * Maps SharePoint group names onto framework capabilities. Groups
 * fall on two orthogonal axes: functional capability (what you can do, anywhere)
 * and per-Case-Type list access (which Case's list you can open). Edit this file
 * to change the group → capability mapping; add new Case Types in
 * `case-types/manifest.js`, from which `permissions.caseTypes` is derived.
 *
 * @typedef {{ slug: string, displayName: string }} CaseTypeGroupSource
 *
 * @typedef {{
 * reviewer: string,
 * adviser: string,
 * controls: string,
 * reviewerManager: string,
 * responsiblePartyManager: string,
 * maintainer: string,
 * caseTypes: CaseTypeGroupSource[]
 * }} PermissionsConfig
 */

import { CASE_TYPES } from '../../case-types/manifest.js';

/**
 * Resolved capabilities for the current user, derived from group membership.
 * `isReviewer` is implied by any `Reviewers - <type>` list-access group as well
 * as the standalone `Reviewers` functional group. `isVisitor` is DERIVED (not
 * config-driven): true iff the user holds no capability at all.
 *
 * These are platform-wide and per-user. They are not the per-Case roles the
 * Case page's access matrix is keyed by, and only some of them ever become
 * one: `resolveRoles` in `section-access.js` is the single translation point,
 * and it documents which capabilities it reads, which it deliberately ignores,
 * and which roles come off the Case row instead of from any group.
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
 * isVisitor: boolean
 * }} Capabilities
 */

/**
 * The three per-Case-Type SharePoint group names, all composed from the Case
 * Type's display name rather than its slug — a Case Type displayed as `Example
 * Review` owns the group `CaseTypeOwner - Example Review`. Deriving them here
 * means provisioning a new type needs one display name, not three hand-written
 * strings.
 *
 * @param {string} displayName
 * @returns {{ listAccess: string, caseTypeOwner: string, journeyOwner: string }}
 */
export function caseTypeGroupNames(displayName) {
  return {
    listAccess: `Reviewers - ${displayName}`,
    caseTypeOwner: `CaseTypeOwner - ${displayName}`,
    journeyOwner: `JourneyOwner - ${displayName}`,
  };
}

/** @type {PermissionsConfig} */
export const permissions = {
  reviewer: 'Reviewers',
  adviser: 'Advisers',
  controls: 'Controls',
  reviewerManager: 'Reviewer Managers',
  responsiblePartyManager: 'ResponsibleParty-Managers',
  maintainer: 'CORA Owner Delegates',
  // Per-Case-Type group names derive from `displayName`: each entry
  // yields `Reviewers - X`, `CaseTypeOwner - X`, and `JourneyOwner - X`.
  // Projected from THE Case Type registry (case-types/manifest.js) so adding a
  // Case Type is one registry edit. That registry holds importer
  // *thunks* only, so reading it here stays synchronous and evaluates no Case
  // Type module — capability resolution remains boot-critical and lazy.
  //
  // Derived ON READ, not snapshotted at module scope. A snapshot was
  // taken the moment this module was first evaluated, so any Case Type
  // registered afterwards was invisible here while `resolveCaseSources()` —
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
 * Resolve a user's group membership against the permissions config into
 * concrete capabilities. UX-only — SharePoint list ACLs are the real boundary.
 *
 * @param {string[]} userGroups
 * @param {PermissionsConfig} [config]
 * @returns {Capabilities}
 */
export function resolveCapabilities(userGroups, config = permissions) {
  const has = (/** @type {string} */ group) => userGroups.includes(group);

  /** @type {string[]} */
  const listAccessCaseTypes = [];
  /** @type {string[]} */
  const ownedCaseTypes = [];
  /** @type {string[]} */
  const ownedJourneyCaseTypes = [];
  for (const { slug, displayName } of config.caseTypes) {
    const names = caseTypeGroupNames(displayName);
    if (has(names.listAccess)) listAccessCaseTypes.push(slug);
    if (has(names.caseTypeOwner)) ownedCaseTypes.push(slug);
    if (has(names.journeyOwner)) ownedJourneyCaseTypes.push(slug);
  }

  // Axis 2 (list access) implies the reviewing function.
  const isReviewer = has(config.reviewer) || listAccessCaseTypes.length > 0;
  const isAdviser = has(config.adviser);
  const isControls = has(config.controls);
  const isReviewerManager = has(config.reviewerManager);
  const isResponsiblePartyManager = has(config.responsiblePartyManager);
  const isMaintainer = has(config.maintainer);
  const isVisitor =
    !isReviewer &&
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
    isVisitor,
  };
}
