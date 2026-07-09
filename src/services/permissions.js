// @ts-check
/**
 * Maps SharePoint group names onto framework capabilities. Groups
 * fall on two orthogonal axes: functional capability (what you can do, anywhere)
 * and per-Case-Type list access (which Case's list you can open). Edit this file
 * to add new Case Types or change the group → capability mapping.
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

/**
 * Resolved capabilities for the current user, derived from group membership
 *. `isReviewer` is implied by any `Reviewers - <type>` list-access
 * group as well as the standalone `Reviewers` functional group. `isVisitor` is
 * DERIVED (not config-driven): true iff the user holds no role at all.
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
 * Type's display name (the architecture decision grill D3 keeps the `CaseTypeOwner - Example
 * Review` naming). Deriving them here means provisioning a new type needs one
 * display name, not three hand-written strings.
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
  reviewerManager: 'Reviewer-Managers',
  // TBC: placeholder SharePoint group names — confirm with the platform owner.
  responsiblePartyManager: 'ResponsibleParty-Managers',
  maintainer: 'CR-Maintainers',
  // Per-Case-Type group names derive from `displayName`: each entry
  // yields `Reviewers - X`, `CaseTypeOwner - X`, and `JourneyOwner - X`.
  caseTypes: [
    { slug: 'example-review', displayName: 'Example Review' },
    { slug: 'complaints', displayName: 'Complaints' },
  ],
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
