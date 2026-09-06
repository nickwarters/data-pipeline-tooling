// src/evaluators/case-lifecycle.js
// @ts-check
/**
 * The pure predicates about where a Case is in its lifecycle, and which side of
 * a Section's two audiences a viewer sits on.
 *
 * They live here rather than in `services/section-access.js` because both that
 * service and the Section plugins need them, and a plugin importing upward from
 * the service made the module graph a cycle: the service reaches the plugins
 * through the registry, and the registry's manifest is evaluated at module
 * scope. Everything imports downward from here instead.
 *
 * @typedef {import('../sharepoint-client.js').CaseRow} CaseRow
 * @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition
 * @typedef {import('../services/section-access.js').Role} Role
 */

import { CASE_STATUS } from '../lib/case-statuses.js';
import { hasTrackableRemediation } from './remediation-status.js';

/**
 * Whether the Case has reached a reportable milestone.
 *
 * @param {string} status
 * @returns {boolean}
 */
export function isReportable(status) {
  return (
    status === CASE_STATUS.ACTIONS_IN_PROGRESS ||
    status === CASE_STATUS.COMPLETED
  );
}

/**
 * Whether the Case has reached a state where the record is frozen.
 *
 * @param {string} status
 * @returns {boolean}
 */
export function isFrozen(status) {
  return isReportable(status) || status === CASE_STATUS.VOID;
}

/**
 * Whether the Case ever passed the reportable milestone, including one it was
 * later voided from.
 *
 * @param {import('../sharepoint-client.js').CaseRow} caseRow
 * @returns {boolean}
 */
export function reachedReportable(caseRow) {
  if (isReportable(caseRow.status)) return true;
  if (caseRow.status === CASE_STATUS.VOID && caseRow.reportableAt) return true;
  return false;
}

/**
 * Whether the Remediation Section has content to show.
 *
 * @param {import('../sharepoint-client.js').CaseRow} caseRow
 * @param {import('../sharepoint-client.js').QuestionDefinition[]} catalogue
 * @returns {boolean}
 */
export function remediationTabIsLive(caseRow, catalogue) {
  return (
    reachedReportable(caseRow) &&
    hasTrackableRemediation(catalogue, caseRow.answers)
  );
}

/**
 * Which of the Remediation Section's two renderings a viewer gets.
 *
 * @param {Role[]} roles
 * @returns {'reviewer' | 'responsibleParty'}
 */
export function remediationAudience(roles) {
  /** @type {Role[]} */
  const reviewerSide = [
    'assignedReviewer',
    'otherReviewer',
    'reviewerManager',
    'caseTypeOwner',
    'controls',
  ];
  return roles.some((role) => reviewerSide.includes(role))
    ? 'reviewer'
    : 'responsibleParty';
}

/**
 * Determine which "side" of a conversation the viewer represents.
 *
 * @param {Role[]} roles
 * @returns {'reviewer' | 'responsibleParty' | null}
 */
export function conversationSideOf(roles) {
  if (
    roles.includes('assignedReviewer') ||
    roles.includes('otherReviewer') ||
    roles.includes('reviewerManager')
  ) {
    return 'reviewer';
  }
  if (
    roles.includes('responsibleParty') ||
    roles.includes('responsiblePartyManager')
  ) {
    return 'responsibleParty';
  }
  return null;
}
