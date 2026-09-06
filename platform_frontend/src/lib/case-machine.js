// @ts-check
// CaseMachine is the Case's lifecycle model and nothing else: given a Case row,
// the current user and the Case Type config, it builds the PATCH fields for
// each transition. It holds no DOM, no signals, and — since the Sections began
// declaring their own access — no view of who may see what.
//
// It knows nothing about Sections. It used to evaluate the whole access matrix
// and answer questions like "may this viewer edit Issues?" off it, which tied a
// domain model to how tabs render. Those predicates are pure functions in
// `evaluators/case-lifecycle.js` now, taking the resolved access map as data,
// and the loader that resolves that map is what calls them.

import { isReportable } from '../evaluators/case-lifecycle.js';

import { addWorkingDays } from './add-working-days.js';
import {
  ENGLAND_WALES_HOLIDAYS,
  REMEDIATION_SLA_WORKING_DAYS,
} from '../config/working-days.js';
import { CASE_STATUS } from './case-statuses.js';
// The one definition of "this Case carries remediation": the Remediation
// tab has ≥1 row. Deliberately catalogue-aware — see `hasTrackableRemediation`.
import { hasTrackableRemediation } from '../evaluators/remediation-status.js';
import {
  awaitingFrontlineCleared,
  awaitingFrontlineSent,
} from '../services/action-centre-flags.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

export class CaseMachine {
  /**
   * @param {CaseRow} caseRow
   * @param {CurrentUser | { id: string }} currentUser
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
   *   stamped as. Omitting it means *no Questions*, so the Remediation
   *   Section resolves `hidden` and a transition stamps
   *   `hadRemediation: false`: build a CaseMachine without one only when you
   *   need neither. No production caller does — `CaseLoader` always supplies
   *   it, and the one that did not built a machine for the Conversation cell
   *   alone, on the standalone Conversation page removed in #790.
   */
  constructor(caseRow, currentUser, config, options = {}) {
    this.caseRow = caseRow;
    this.currentUser = currentUser;
    this.config = config;
    this._now = options.now ?? (() => new Date());
    /** @type {QuestionDefinition[]} */
    this.catalogue = options.catalogue ?? [];
  }

  /**
   * Whether the Case has reached the reportable freeze point. Gates
   * editability everywhere the old code hard-coded `status === 'In-progress'`.
   */
  get reportable() {
    return isReportable(this.caseRow.status);
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
   * The Awaiting Frontline pair it starts needs no new clearing transition:
   * `transitionToFinalComplete` and `transitionToVoid` are the only exits from
   * `Actions In Progress`, and both already clear it.
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
      // stored on the row — never recomputed on read. The reportable moment is
      // the SLA start; the due date is that plus the Case Type's remediation
      // SLA in working days, or the framework's when it declares none. Because
      // the date is stored, changing the Case Type's SLA moves no date already
      // written: only later transitions see the new number.
      remediationDueDate: addWorkingDays(
        reportableAt,
        this.config.remediationSlaWorkingDays ?? REMEDIATION_SLA_WORKING_DAYS,
        ENGLAND_WALES_HOLIDAYS
      ),
      ...awaitingFrontlineSent(reportableAt),
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
      // A closed Case waits on nobody. Without this the Reviewer's last
      // unanswered question would keep it in their Awaiting Frontline group,
      // ageing past its SLA, with no transition left to clear it.
      ...awaitingFrontlineCleared(),
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
      ...awaitingFrontlineCleared(),
    };
  }

  /**
   * **Void**: the Case is abandoned with a reason and there is no way back.
   *
   * Deliberately stamps no Outcome and no `reportableAt`: a voided Case was
   * never reviewed to a conclusion, so giving it one would put a result into
   * every report that counts Outcomes. Whatever was stamped before the void
   * — on a Case voided after Send Actions — is left exactly as it was.
   *
   * The hold and the Awaiting Frontline clocks are cleared for the same reason
   * a close clears them: a terminal Case waits on nobody, and no later
   * transition would ever clear them.
   *
   * The note is what `other` means, and nothing else carries it: a keyed reason
   * already names itself, so the note is stored trimmed or as an explicit
   * `null` rather than as an empty string a reader would have to interpret.
   *
   * @param {string} reasonKey a key from the Void Reason vocabulary
   * @param {string} [note] the Reviewer's written reason, required under `other`
   * @returns {Partial<CaseRow>}
   */
  transitionToVoid(reasonKey, note = '') {
    const written = note.trim();
    return {
      status: CASE_STATUS.VOID,
      voidReason: reasonKey,
      voidReasonNote: written === '' ? null : written,
      voidedAt: this._now().toISOString(),
      voidedBy: this.currentUser.id,
      onHold: false,
      placedOnHoldAt: null,
      ...awaitingFrontlineCleared(),
    };
  }
}
