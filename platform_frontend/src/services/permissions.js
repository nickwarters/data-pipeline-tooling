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
import { noRoles } from './user-roles.js';

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
 * canSearchCases: boolean,
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

/**
 * The frontline list-access group for a Case Type, which grants no capability and only lets the Case list be opened.
 *
 * @param {string} displayName
 * @returns {string}
 */
export function frontlineListAccessGroupName(displayName) {
  return `Frontline - ${displayName}`;
}

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
  reviewer: 'Reviewers',
  // The site-wide frontline base group. Named `Frontline` in the tenant while
  // the capability it grants stays `isAdviser` and the domain term stays
  // **Adviser** — this file is the group-name -> capability mapping, and the
  // two names already differ elsewhere (`maintainer` <- `CORA Owner
  // Delegates`). Matched by exact equality like every other group here, so the
  // per-Case-Type `Frontline - <type>` list-access groups are separate groups
  // and never fold into this one.
  adviser: 'Frontline',
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
 * Resolve a user's group membership and `CoraUserRoles` row against the
 * permissions config into concrete capabilities. UX-only — SharePoint list
 * ACLs are the real boundary.
 *
 * While the roles move from groups to the row, either one grants a role, so
 * nobody loses one by being moved before or after the other. A slug in the row
 * that names no Case Type this application has grants nothing.
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
  const has = (/** @type {string} */ group) => userGroups.includes(group);

  /** @type {string[]} */
  const listAccessCaseTypes = [];
  /** @type {string[]} */
  const ownedCaseTypes = [];
  /** @type {string[]} */
  const ownedJourneyCaseTypes = [];
  for (const { slug, displayName } of config.caseTypes) {
    const names = caseTypeGroupNames(displayName);
    if (has(names.listAccess) || userRoles.reviews.includes(slug))
      listAccessCaseTypes.push(slug);
    if (has(names.caseTypeOwner) || userRoles.ownsCaseTypes.includes(slug))
      ownedCaseTypes.push(slug);
    if (has(names.journeyOwner) || userRoles.journeyOwnerOf.includes(slug))
      ownedJourneyCaseTypes.push(slug);
  }

  // Axis 2 (list access) implies the reviewing function.
  const isReviewer =
    has(config.reviewer) ||
    userRoles.reviewer ||
    listAccessCaseTypes.length > 0;
  const isAdviser = has(config.adviser) || userRoles.adviser;
  const isControls = has(config.controls) || userRoles.controls;
  const isReviewerManager =
    has(config.reviewerManager) || userRoles.reviewerManager;
  const isResponsiblePartyManager =
    has(config.responsiblePartyManager) || userRoles.responsiblePartyManager;
  const isMaintainer = has(config.maintainer);
  // Widening search to a second role is this one line and no call site.
  const canSearchCases = isControls;
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
    canSearchCases,
    isVisitor,
  };
}

/**
 * The current user's `CoraUserRoles` row for capability resolution. While the
 * groups still grant every role, a row that cannot be read grants nothing
 * rather than stopping the app: it can only narrow access, never widen it, and
 * the groups carry on granting what they always did.
 *
 * @param {Pick<import('../sharepoint-client.js').SharePointClient, 'getUserRoles'>} client
 * @param {string} account
 * @returns {Promise<import('./user-roles.js').UserRoles>}
 */
export async function readUserRoles(client, account) {
  try {
    return await client.getUserRoles(account);
  } catch (error) {
    console.warn('[CORA] Roles could not be read; using groups only:', error);
    return noRoles();
  }
}
