// @ts-check
// CaseMachine is a pure state model: given a Case row, the current user, their
// capabilities and the Case Type config, it derives roles, the section access
// matrix, and the lifecycle transition PATCH fields. It holds
// no DOM and no signals — the function-component page (CaseReviewPage) reads it
// through the loader, so it is plain domain state, not a UI orchestration
// layer around view rendering.

import {
  evaluateAccess,
  isReportable,
  resolveRoles,
  SECTIONS,
} from '../services/section-access.js';

// Re-exported from its leaf home in section-access.js (the access matrix also
// keys its freeze/gate cells off it) so lifecycle consumers can import the
// reportable predicate alongside CaseMachine without a circular import.
export { isReportable } from '../services/section-access.js';

import { addWorkingDays } from './add-working-days.js';
import {
  ENGLAND_WALES_HOLIDAYS,
  REMEDIATION_SLA_WORKING_DAYS,
} from '../config/working-days.js';
import { CASE_STATUS } from './case-statuses.js';
// The one definition of "this Case carries remediation" (#502): the Remediation
// tab has ≥1 row. Deliberately catalogue-aware — see `hasTrackableRemediation`.
import { hasTrackableRemediation } from '../evaluators/remediation-status.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

export class CaseMachine {
  /**
   * @param {CaseRow} caseRow
   * @param {CurrentUser | { id: string }} currentUser
   * @param {Capabilities} capabilities
   * @param {CaseTypeConfig} config
   * @param {{ now?: () => Date, catalogue?: QuestionDefinition[] }} [options]
   *   `now` is an injectable clock for the lifecycle timestamps below; a caller
   *   that cares about `reportableAt` / `completedAt` — a test, or any future
   *   caller replaying a Case — supplies its own.
   *
   *   `catalogue` is the Case's **resolved** Question catalogue: the live bank
   *   while `In-progress`, the stamped versioned export once reportable, in
   *   both cases with `failureValues` derived (`CaseLoader` builds
   *   exactly this). It decides what remediation the Case carries — hence
   *   whether the Remediation Section exists and what `hadRemediation` is
   *   stamped as (#502). Omitting it means *no Questions*, so the Remediation
   *   Section resolves `hidden` and a transition stamps
   *   `hadRemediation: false`: build a CaseMachine without one only when you
   *   need neither, as `cora-conversation-view.js` does for the Conversation
   *   cell alone.
   */
  constructor(caseRow, currentUser, capabilities, config, options = {}) {
    this.caseRow = caseRow;
    this.currentUser = currentUser;
    this.capabilities = capabilities;
    this.config = config;
    this._now = options.now ?? (() => new Date());
    /** @type {QuestionDefinition[]} */
    this.catalogue = options.catalogue ?? [];

    this.roles = resolveRoles(caseRow, currentUser.id, capabilities);

    /** @type {Record<import('../services/section-access.js').Section, import('../services/section-access.js').Mode>} */
    this.access = /** @type {any} */ ({});
    for (const s of SECTIONS) {
      this.access[s] = evaluateAccess(
        s,
        this.roles,
        caseRow,
        config,
        this.catalogue
      );
    }
  }

  /**
   * Whether the Case has reached the reportable freeze point. Gates
   * editability everywhere the old code hard-coded `status === 'In-progress'`.
   */
  get reportable() {
    return isReportable(this.caseRow.status);
  }

  get canComplete() {
    return (
      this.access.questions === 'edit' &&
      this.caseRow.assignedReviewer === this.currentUser.id &&
      !this.reportable
    );
  }

  get canAttribute() {
    return (
      this.config.attributeFailures === true &&
      this.access.issues === 'edit' &&
      !this.reportable
    );
  }

  get canCapture() {
    return this.canAttribute;
  }

  /**
   * Whether the viewer may pick which configured Remediation Actions apply to a
   * failed Answer and, when the Question allows it, add a free-form action
   *. Unlike `canAttribute`/`canCapture`, this is not gated on the
   * Case Type opting into `attributeFailures`: any editor of the Issues tab
   * (the Assigned Reviewer on a not-yet-reportable Case) may select actions.
   */
  get canSelectRemediation() {
    return this.access.issues === 'edit' && !this.reportable;
  }

  /**
   * The *permission* half of the final-complete gate, and **only** that half —
   * hence the name: this getter says the viewer *may resolve* remediation, not
   * that the Case is ready to close. Once actions have been **sent**, only the
   * Assigned Reviewer — the one role that can `edit` the Remediation tab — closes
   * an `Actions In Progress` Case to `Completed`.
   *
   * The *content* half (every Question's remediation resolved, with its required
   * details / justification) lives in `completionControl` / `completionPatch`,
   * which read the store's **live** Answers rather than the load-time snapshot
   * this machine holds — the Reviewer must be able to resolve the last row and
   * see the button enable without a reload (#499).
   */
  get mayResolveRemediation() {
    return (
      this.access.remediation === 'edit' &&
      this.caseRow.assignedReviewer === this.currentUser.id &&
      this.caseRow.status === CASE_STATUS.ACTIONS_IN_PROGRESS
    );
  }

  get canToggleConversation() {
    return this.access.conversation !== 'hidden';
  }

  /**
   * The shared **reportable milestone** snapshot: the single point at
   * which a Case's Answers freeze and its Outcome is stamped for reporting. Used
   * by both the "Send Actions" (→ `Actions In Progress`) and no-actions
   * "Complete Case" (→ `Completed`) paths; each caller adds `status`, the
   * `reportableAt` timestamp, and — on the actions path — the remediation due
   * date.
   *
   * @param {((answers: Record<string, Answer>) => import('../sharepoint-client.js').OutcomeResult) | null | undefined} computeOutcome
   * @param {Record<string, Answer>} [answers]
   * @param {string | null} [questionBankVersion]
   * @returns {Partial<CaseRow>}
   */
  _reportableSnapshot(computeOutcome, answers, questionBankVersion) {
    /** @type {Partial<CaseRow>} */
    const fields = {};
    if (computeOutcome && answers) {
      fields.outcomeAtCompletion = computeOutcome(answers).outcome;
      fields.hadRemediation = hasTrackableRemediation(this.catalogue, answers);
      fields.effectiveOutcome = fields.outcomeAtCompletion;
      fields.effectiveHadRemediation = fields.hadRemediation;
      fields.outcomeOverridden = false;
    }
    if (questionBankVersion) {
      fields.questionBankVersion = questionBankVersion;
    }
    return fields;
  }

  /**
   * **Send Actions** (actions path): the Case has ≥1 Remediation Action, so it
   * hands off to `Actions In Progress`. This is the reportable milestone — the
   * snapshot is stamped here, `reportableAt` is set, but `completedAt` is not
   * (the Case is not yet closed).
   *
   * @param {((answers: Record<string, Answer>) => import('../sharepoint-client.js').OutcomeResult) | null | undefined} computeOutcome
   * @param {Record<string, Answer>} [answers]
   * @param {string | null} [questionBankVersion]
   * @returns {Partial<CaseRow>}
   */
  transitionToActionsInProgress(computeOutcome, answers, questionBankVersion) {
    const reportableAt = this._now().toISOString();
    return {
      status: CASE_STATUS.ACTIONS_IN_PROGRESS,
      reportableAt,
      // Remediation SLA due date, computed **once** here at Send Actions and
      // stored on the row — never recomputed on read. The reportable
      // moment is the SLA start; the due date is +10 working days from it.
      remediationDueDate: addWorkingDays(
        reportableAt,
        REMEDIATION_SLA_WORKING_DAYS,
        ENGLAND_WALES_HOLIDAYS
      ),
      ...this._reportableSnapshot(computeOutcome, answers, questionBankVersion),
    };
  }

  /**
   * No-actions **Complete Case**: the Case has no Remediation Actions, so it
   * goes straight to `Completed`. This is both the reportable milestone and the
   * final close, so `reportableAt` and `completedAt` coincide and the snapshot
   * is stamped in the same PATCH.
   *
   * @param {((answers: Record<string, Answer>) => import('../sharepoint-client.js').OutcomeResult) | null | undefined} computeOutcome
   * @param {Record<string, Answer>} [answers]
   * @param {string | null} [questionBankVersion]
   * @returns {Partial<CaseRow>}
   */
  transitionToCompleted(computeOutcome, answers, questionBankVersion) {
    const now = this._now().toISOString();
    return {
      status: CASE_STATUS.COMPLETED,
      reportableAt: now,
      completedAt: now,
      ...this._reportableSnapshot(computeOutcome, answers, questionBankVersion),
    };
  }

  /**
   * The **final complete** transition (actions path): once the Remediation tab
   * is complete, an `Actions In Progress` Case closes to `Completed`.
   * The Answers and Outcome were already frozen at Send Actions, so this stamps
   * `completedAt` only — no re-snapshot.
   *
   * @returns {Partial<CaseRow>}
   */
  transitionToFinalComplete() {
    return {
      status: CASE_STATUS.COMPLETED,
      completedAt: this._now().toISOString(),
    };
  }
}
