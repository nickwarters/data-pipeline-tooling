// @ts-check

/**
 * Maps SharePoint group names onto framework capabilities. Edit this file to
 * add new Case Types or change the group → capability mapping.
 *
 * @typedef {{
 *   reviewer: string,
 *   caseTypeOwners: Record<string, string>,
 *   responsibleParty: string,
 *   reviewerManager: string,
 *   responsiblePartyManager: string,
 *   maintainer: string,
 *   qaReviewer: string
 * }} PermissionsConfig
 */

/**
 * Resolved capabilities for the current user, derived from group membership.
 * `isVisitor` is DERIVED (not config-driven): true iff the user holds no role.
 *
 * @typedef {{
 *   isReviewer: boolean,
 *   ownedCaseTypes: string[],
 *   isResponsibleParty: boolean,
 *   isReviewerManager: boolean,
 *   isResponsiblePartyManager: boolean,
 *   isMaintainer: boolean,
 *   isQaReviewer: boolean,
 *   isVisitor: boolean
 * }} Capabilities
 */

/** @type {PermissionsConfig} */
export const permissions = {
  reviewer: 'Reviewers',
  caseTypeOwners: {
    'hello-review': 'CaseTypeOwners-HelloReview',
  },
  responsibleParty: 'CR-ResponsibleParty',
  reviewerManager: 'Reviewer-Managers',
  // TBC: placeholder SharePoint group names — confirm with the platform owner.
  responsiblePartyManager: 'ResponsibleParty-Managers',
  maintainer: 'CR-Maintainers',
  qaReviewer: 'QA-Reviewers',
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
  const isReviewer = userGroups.includes(config.reviewer);
  const ownedCaseTypes = Object.entries(config.caseTypeOwners)
    .filter(([, group]) => userGroups.includes(group))
    .map(([slug]) => slug);
  const isResponsibleParty = userGroups.includes(config.responsibleParty);
  const isReviewerManager = userGroups.includes(config.reviewerManager);
  const isResponsiblePartyManager = userGroups.includes(config.responsiblePartyManager);
  const isMaintainer = userGroups.includes(config.maintainer);
  const isQaReviewer = userGroups.includes(config.qaReviewer);
  const isVisitor =
    !isReviewer &&
    !isReviewerManager &&
    !isResponsiblePartyManager &&
    !isMaintainer &&
    !isResponsibleParty &&
    !isQaReviewer &&
    ownedCaseTypes.length === 0;
  return {
    isReviewer,
    ownedCaseTypes,
    isResponsibleParty,
    isReviewerManager,
    isResponsiblePartyManager,
    isMaintainer,
    isQaReviewer,
    isVisitor,
  };
}
