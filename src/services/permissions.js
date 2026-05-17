// @ts-check

/**
 * Maps SharePoint group names onto framework capabilities. Edit this file to
 * add new Case Types or change the group → capability mapping.
 *
 * @typedef {{
 *   reviewer: string,
 *   caseTypeOwners: Record<string, string>,
 *   responsibleParty: string,
 *   reviewerManager: string
 * }} PermissionsConfig
 */

/**
 * Resolved capabilities for the current user, derived from group membership.
 *
 * @typedef {{
 *   isReviewer: boolean,
 *   ownedCaseTypes: string[],
 *   isResponsibleParty: boolean,
 *   isReviewerManager: boolean
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
  return { isReviewer, ownedCaseTypes, isResponsibleParty, isReviewerManager };
}
