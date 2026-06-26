// @ts-check
import {
  evaluateAccess,
  resolveRoles,
  SECTIONS,
} from '../services/section-access.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

export class CaseMachine {
  /**
   * @param {CaseRow} caseRow
   * @param {CurrentUser | { id: string }} currentUser
   * @param {Capabilities} capabilities
   * @param {CaseTypeConfig} config
   */
  constructor(caseRow, currentUser, capabilities, config) {
    this.caseRow = caseRow;
    this.currentUser = currentUser;
    this.capabilities = capabilities;
    this.config = config;

    this.roles = resolveRoles(caseRow, currentUser.id, capabilities);

    /** @type {Record<import('../services/section-access.js').Section, import('../services/section-access.js').Mode>} */
    this.access = /** @type {any} */ ({});
    for (const s of SECTIONS) {
      this.access[s] = evaluateAccess(s, this.roles, caseRow, config);
    }
  }

  get canComplete() {
    return (
      this.access.questions === 'edit' &&
      this.caseRow.assignedReviewer === this.currentUser.id &&
      this.caseRow.status === 'In-progress'
    );
  }

  get canAttribute() {
    return (
      this.config.attributeFailures === true &&
      this.access.remediation === 'edit' &&
      this.caseRow.status === 'In-progress'
    );
  }

  get canCapture() {
    return this.canAttribute;
  }

  get canToggleConversation() {
    return this.access.conversation !== 'hidden';
  }

  /**
   * @param {((answers: Record<string, Answer>) => import('../sharepoint-client.js').OutcomeResult) | null | undefined} computeOutcome
   * @param {Record<string, Answer>} [answers]
   * @param {string | null} [questionBankVersion]
   * @returns {Partial<CaseRow>}
   */
  transitionToCompleted(computeOutcome, answers, questionBankVersion) {
    /** @type {Partial<CaseRow>} */
    const fields = {
      status: 'Completed',
      completedAt: new Date().toISOString(),
    };
    if (computeOutcome && answers) {
      fields.outcomeAtCompletion = computeOutcome(answers).verdict;
      fields.hadRemediation = Object.values(answers).some(
        (a) => (a.remediationActions?.length ?? 0) > 0
      );
      fields.effectiveOutcome = fields.outcomeAtCompletion;
      fields.effectiveHadRemediation = fields.hadRemediation;
      fields.outcomeOverridden = false;
    }
    if (questionBankVersion) {
      fields.questionBankVersion = questionBankVersion;
    }
    return fields;
  }
}
