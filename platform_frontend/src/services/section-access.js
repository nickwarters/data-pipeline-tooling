// src/services/section-access.js
// @ts-check
/**
 * Role-based access control for Case Review sections.
 *
 * Each SectionPlugin owns its own `evaluateAccess` logic. This module resolves
 * the viewer's effective roles from SharePoint context, provides summary
 * section resolution, and dispatches access evaluation across section plugins.
 */

import { CASE_STATUS } from '../lib/case-statuses.js';
import { hasTrackableRemediation } from '../evaluators/remediation-status.js';
import {
  sectionIds,
  sectionById,
  summaryBlockIds,
} from '../lib/section-registry.js';
import { APPEALS_ENABLED } from '../config/features.js';
import { getSectionPlugin } from '../sections/registry.js';

/** @typedef {import('../lib/section-registry.js').Section} Section */

/**
 * Access modes a section can resolve to for a viewer.
 *
 * - `edit`: Section is displayed, interactive controls are enabled.
 * - `read-only`: Section is displayed, inputs are disabled.
 * - `hidden`: Neither the tab nor the section panel is rendered.
 *
 * @typedef {'edit' | 'read-only' | 'hidden'} Mode
 */

/**
 * The roles recognized by the Case Review access control system.
 *
 * - `assignedReviewer`: Current user is the assigned reviewer on the case.
 * - `otherReviewer`: Current user is in the Reviewers group but not assigned.
 * - `reviewerManager`: Current user is the manager of the assigned reviewer.
 * - `responsibleParty`: Current user is the person who carried out the work.
 * - `responsiblePartyManager`: Current user is the manager of the responsible party.
 * - `caseTypeOwner`: Current user is an owner of this case type.
 * - `journeyOwner`: Current user is the owner of the end-to-end journey.
 * - `controls`: Current user is in the Controls group (QA/compliance).
 * - `none`: Current user holds none of the recognized roles for this case.
 *
 * @typedef {'assignedReviewer' | 'otherReviewer' | 'reviewerManager' | 'responsibleParty' | 'responsiblePartyManager' | 'caseTypeOwner' | 'journeyOwner' | 'controls' | 'none'} Role
 */

/**
 * The exhaustive list of Role values. Used by contract tests to ensure
 * access policies handle every role.
 *
 * @type {readonly Role[]}
 */
export const ROLES = Object.freeze([
  'assignedReviewer',
  'otherReviewer',
  'reviewerManager',
  'responsibleParty',
  'responsiblePartyManager',
  'caseTypeOwner',
  'journeyOwner',
  'controls',
  'none',
]);

/**
 * The Section ids in canonical order.
 * @type {Section[]}
 */
export const SECTIONS = sectionIds();

/**
 * The Section ids that can contribute a Summary block.
 * @type {Section[]}
 */
export const SUMMARY_SECTIONS = summaryBlockIds();

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
 * Given a viewer's permissions context, compute the list of roles they hold on
 * this Case.
 *
 * @param {import('../sharepoint-client.js').CaseRow} caseRow
 * @param {string} userId
 * @param {import('./permissions.js').Capabilities} capabilities
 * @returns {Role[]}
 */
export function resolveRoles(caseRow, userId, capabilities) {
  /** @type {Role[]} */
  const roles = [];
  if (caseRow.assignedReviewer === userId) {
    roles.push('assignedReviewer');
  } else if (capabilities?.isReviewer) {
    roles.push('otherReviewer');
  }
  if (caseRow.assignedReviewerManager === userId) {
    roles.push('reviewerManager');
  }
  if (caseRow.responsibleParty === userId) {
    roles.push('responsibleParty');
  }
  if (caseRow.responsiblePartyManager === userId) {
    roles.push('responsiblePartyManager');
  }
  if (capabilities?.ownedCaseTypes?.includes(caseRow.caseType)) {
    roles.push('caseTypeOwner');
  }
  if (capabilities?.ownedJourneyCaseTypes?.includes(caseRow.caseType)) {
    roles.push('journeyOwner');
  }
  if (capabilities?.isControls) {
    roles.push('controls');
  }

  if (roles.length === 0) roles.push('none');
  return roles;
}

/**
 * Summary sections whose visibility is gated on the Summary section's access mode
 * rather than their own section's access mode.
 */
export const READ_THROUGH_SUMMARY = Object.freeze(
  /** @type {const} */ (['details'])
);

/**
 * Whether a Section should be rendered in the Summary view for the given viewer.
 *
 * @param {Section} section
 * @param {import('../sharepoint-client.js').CaseTypeConfig} [caseTypeConfig]
 * @param {Role[]} [roles]
 * @returns {boolean}
 */
export function showInSummary(section, caseTypeConfig, roles = []) {
  const sections = caseTypeConfig?.sections;
  if (sections && !(section in sections)) return false;
  const explicit = sections?.[section]?.showInSummary;
  if (Array.isArray(explicit)) return roles.some((r) => explicit.includes(r));
  if (explicit !== undefined) return explicit;
  return sectionById(section)?.showInSummaryDefault ?? true;
}

/**
 * Filter the Summary block sections by current section access and visibility configuration.
 *
 * @param {Record<string, Mode>} access
 * @param {import('../sharepoint-client.js').CaseTypeConfig} caseTypeConfig
 * @param {Role[]} [roles]
 * @returns {Section[]}
 */
export function summarySectionsFor(access, caseTypeConfig, roles = []) {
  return SUMMARY_SECTIONS.filter((section) => {
    const gate = READ_THROUGH_SUMMARY.includes(/** @type {any} */ (section))
      ? 'summary'
      : section;
    return (
      access[gate] !== 'hidden' && showInSummary(section, caseTypeConfig, roles)
    );
  });
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
 * Resolve the effective access mode for a section given the viewer's roles.
 *
 * @param {string} section
 * @param {Role[]} roles
 * @param {import('../sharepoint-client.js').CaseRow} caseRow
 * @param {import('../sharepoint-client.js').CaseTypeConfig} [caseTypeConfig]
 * @param {import('../sharepoint-client.js').QuestionDefinition[]} [catalogue]
 * @param {import('./permissions.js').Capabilities} [capabilities]
 * @returns {Mode}
 */
export function evaluateAccess(
  section,
  roles,
  caseRow,
  caseTypeConfig = /** @type {any} */ ({}),
  catalogue = [],
  capabilities = /** @type {any} */ ({})
) {
  if (!APPEALS_ENABLED) {
    if (section === 'appealRequest') return 'hidden';
    if (section === 'appealReview') return 'hidden';
  }
  if (caseTypeConfig?.sections && !(section in caseTypeConfig.sections)) {
    return 'hidden';
  }
  const plugin = getSectionPlugin(section);
  if (plugin) {
    return plugin.evaluateAccess({
      caseRow,
      roles,
      capabilities,
      sectionConfig: caseTypeConfig?.sections?.[section],
      catalogue,
      config: caseTypeConfig,
    });
  }
  return 'hidden';
}
