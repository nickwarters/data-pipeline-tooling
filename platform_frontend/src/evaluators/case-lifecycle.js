// src/evaluators/case-lifecycle.js
// @ts-check
/**
 * The pure predicates about where a Case is in its lifecycle, which side of a
 * Section's two audiences a viewer sits on, and what that viewer may do to it.
 *
 * The permission predicates at the foot take the resolved `access` map as
 * **data**. That is what lets them live here rather than in the lifecycle
 * model: a Case's transitions are a domain fact and Section access is a UI one,
 * and the thing that needed both was reading the second through the first.
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

/**
 * Whether the viewer may take the Case's no-actions completion path.
 *
 * The *permission* half only. Whether the Case is ready — every applicable
 * Question answered, every required detail written — lives in
 * `completionControl`, which reads the store's live Answers rather than the
 * load-time snapshot these predicates are derived from.
 *
 * @param {{ access: Record<string, string>, caseRow: CaseRow, currentUserId: string }} input
 * @returns {boolean}
 */
export function canCompleteCase({ access, caseRow, currentUserId }) {
  return (
    access.questions === 'edit' &&
    caseRow.assignedReviewer === currentUserId &&
    !isFrozen(caseRow.status)
  );
}

/**
 * Whether the viewer may edit what the Issues Section records against a failed
 * Answer. No Case Type opt-in stands in front of this gate: a Case Type that
 * declares nothing to capture simply renders nothing to edit.
 *
 * @param {{ access: Record<string, string>, caseRow: CaseRow }} input
 * @returns {boolean}
 */
export function canEditIssues({ access, caseRow }) {
  return access.issues === 'edit' && !isFrozen(caseRow.status);
}

/**
 * The *permission* half of the final-complete gate, and only that half — hence
 * the name: this says the viewer may resolve remediation, not that the Case is
 * ready to close. Once actions have been sent, only the Assigned Reviewer — the
 * one role that can `edit` the Remediation Section — closes an
 * `Actions In Progress` Case.
 *
 * @param {{ access: Record<string, string>, caseRow: CaseRow, currentUserId: string }} input
 * @returns {boolean}
 */
export function mayResolveRemediation({ access, caseRow, currentUserId }) {
  return (
    access.remediation === 'edit' &&
    caseRow.assignedReviewer === currentUserId &&
    caseRow.status === CASE_STATUS.ACTIONS_IN_PROGRESS
  );
}

/**
 * Whether the viewer may void the Case: the Assigned Reviewer, while the review
 * is still live. Both terminal states are excluded — a Completed Case has a
 * result to preserve, and a voided one is already where voiding leads.
 *
 * @param {{ caseRow: CaseRow, currentUserId: string }} input
 * @returns {boolean}
 */
export function canVoidCase({ caseRow, currentUserId }) {
  return (
    caseRow.assignedReviewer === currentUserId &&
    (caseRow.status === CASE_STATUS.IN_PROGRESS ||
      caseRow.status === CASE_STATUS.ACTIONS_IN_PROGRESS)
  );
}

/**
 * Whether the Conversation panel can be opened at all.
 *
 * @param {{ access: Record<string, string> }} input
 * @returns {boolean}
 */
export function canToggleConversation({ access }) {
  return access.conversation !== 'hidden';
}

/**
 * What the Case Review page reads about a loaded Case: what this viewer may do
 * to it, and how each transition writes it.
 *
 * Composed by `CaseLoader` from two halves that used to be one object — the
 * permissions above, derived from the resolved Section access map, and the
 * transitions the lifecycle model builds. Plain data plus functions, so no
 * consumer has to know which half a member came from, and nothing in route
 * state is an instance of anything.
 *
 * @typedef {Object} CaseLifecycleView
 * @property {Role[]} roles
 * @property {QuestionDefinition[]} catalogue
 * @property {boolean} canComplete
 * @property {boolean} canEditIssues
 * @property {boolean} mayResolveRemediation
 * @property {boolean} canVoid
 * @property {boolean} canToggleConversation
 * @property {(...args: any[]) => Partial<CaseRow>} transitionToActionsInProgress
 * @property {(...args: any[]) => Partial<CaseRow>} transitionToCompleted
 * @property {() => Partial<CaseRow>} transitionToFinalComplete
 * @property {(reasonKey: string, note?: string) => Partial<CaseRow>} transitionToVoid
 */
