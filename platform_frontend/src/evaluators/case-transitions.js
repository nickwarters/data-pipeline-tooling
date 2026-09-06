// @ts-check
/**
 * The Case's lifecycle transitions: given where a Case is and what it holds,
 * the PATCH fields that move it. Pure functions of their arguments — nothing
 * here reads a Case row it was not handed, and nothing here is an instance.
 *
 * A module of its own rather than part of `case-lifecycle.js`, which is
 * deliberately import-light: these need `action-centre-flags.js`, which reaches
 * `services/section-access.js`, which reads `case-lifecycle.js`. Putting them
 * there would close exactly the cycle that module was carved out to break.
 *
 * @typedef {import('../sharepoint-client.js').CaseRow} CaseRow
 * @typedef {import('../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig
 * @typedef {import('../sharepoint-client.js').Answer} Answer
 * @typedef {import('../sharepoint-client.js').OutcomeResult} OutcomeResult
 * @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition
 * @typedef {(answers: Record<string, Answer>) => OutcomeResult} ComputeOutcome
 * @typedef {{
 *   catalogue?: QuestionDefinition[],
 *   answers?: Record<string, Answer>,
 *   computeOutcome?: ComputeOutcome | null,
 *   questionBankVersion?: string | null,
 *   now?: () => Date,
 * }} ReportableInput
 */

import { CASE_STATUS } from '../lib/case-statuses.js';
import { addWorkingDays } from '../lib/add-working-days.js';
import {
  ENGLAND_WALES_HOLIDAYS,
  REMEDIATION_SLA_WORKING_DAYS,
} from '../config/working-days.js';
// The one definition of "this Case carries remediation": the Remediation
// Section has ≥1 row. Deliberately catalogue-aware — see `hasTrackableRemediation`.
import { hasTrackableRemediation } from './remediation-status.js';
import {
  awaitingFrontlineCleared,
  awaitingFrontlineSent,
} from '../services/action-centre-flags.js';

/**
 * The shared **reportable milestone** snapshot: the single point at which a
 * Case's Answers freeze and its Outcome is stamped for reporting. Both paths
 * out of a live review stamp it — "Send Actions" and the no-actions "Complete
 * Case" — and each adds its own status and timestamps on top.
 *
 * @param {ReportableInput} input
 * @returns {Partial<CaseRow>}
 */
export function buildReportableSnapshot({
  catalogue = [],
  answers,
  computeOutcome,
  questionBankVersion,
}) {
  /** @type {Partial<CaseRow>} */
  const fields = {};
  if (computeOutcome && answers) {
    fields.outcomeAtCompletion = computeOutcome(answers).outcome;
    fields.hadRemediation = hasTrackableRemediation(catalogue, answers);
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
 * snapshot is stamped here and `reportableAt` is set, but `completedAt` is not,
 * because the Case is not yet closed.
 *
 * The Awaiting Frontline pair it starts needs no new clearing transition: the
 * final complete and the void are the only exits from `Actions In Progress`,
 * and both already clear it.
 *
 * @param {ReportableInput & { config?: CaseTypeConfig }} input
 * @returns {Partial<CaseRow>}
 */
export function buildActionsInProgressTransition({
  config,
  now = () => new Date(),
  ...snapshot
}) {
  const reportableAt = now().toISOString();
  return {
    status: CASE_STATUS.ACTIONS_IN_PROGRESS,
    reportableAt,
    // Remediation SLA due date, computed **once** here at Send Actions and
    // stored on the row — never recomputed on read. The reportable moment is
    // the SLA start; the due date is that plus the Case Type's remediation SLA
    // in working days, or the framework's when it declares none. Because the
    // date is stored, changing the Case Type's SLA moves no date already
    // written: only later transitions see the new number.
    remediationDueDate: addWorkingDays(
      reportableAt,
      config?.remediationSlaWorkingDays ?? REMEDIATION_SLA_WORKING_DAYS,
      ENGLAND_WALES_HOLIDAYS
    ),
    ...awaitingFrontlineSent(reportableAt),
    ...buildReportableSnapshot(snapshot),
  };
}

/**
 * No-actions **Complete Case**: the Case has no Remediation Actions, so it goes
 * straight to `Completed`. This is both the reportable milestone and the final
 * close, so `reportableAt` and `completedAt` coincide and the snapshot is
 * stamped in the same PATCH.
 *
 * @param {ReportableInput} input
 * @returns {Partial<CaseRow>}
 */
export function buildCompletedTransition({
  now = () => new Date(),
  ...snapshot
}) {
  const timestamp = now().toISOString();
  return {
    status: CASE_STATUS.COMPLETED,
    reportableAt: timestamp,
    completedAt: timestamp,
    // A closed Case waits on nobody. Without this the Reviewer's last
    // unanswered question would keep it in their Awaiting Frontline group,
    // ageing past its SLA, with no transition left to clear it.
    ...awaitingFrontlineCleared(),
    ...buildReportableSnapshot(snapshot),
  };
}

/**
 * The **final complete** transition (actions path): once the Remediation
 * Section is complete, an `Actions In Progress` Case closes to `Completed`. The
 * Answers and Outcome were already frozen at Send Actions, so this stamps
 * `completedAt` only — no re-snapshot.
 *
 * @param {{ now?: () => Date }} [input]
 * @returns {Partial<CaseRow>}
 */
export function buildFinalCompleteTransition({ now = () => new Date() } = {}) {
  return {
    status: CASE_STATUS.COMPLETED,
    completedAt: now().toISOString(),
    ...awaitingFrontlineCleared(),
  };
}

/**
 * **Void**: the Case is abandoned with a reason and there is no way back.
 *
 * Deliberately stamps no Outcome and no `reportableAt`: a voided Case was never
 * reviewed to a conclusion, so giving it one would put a result into every
 * report that counts Outcomes. Whatever was stamped before the void — on a Case
 * voided after Send Actions — is left exactly as it was.
 *
 * The hold and the Awaiting Frontline clocks are cleared for the same reason a
 * close clears them: a terminal Case waits on nobody, and no later transition
 * would ever clear them.
 *
 * The note is what `other` means, and nothing else carries it: a keyed reason
 * already names itself, so the note is stored trimmed or as an explicit `null`
 * rather than as an empty string a reader would have to interpret.
 *
 * @param {{
 *   currentUserId: string,
 *   reasonKey: string,
 *   note?: string,
 *   now?: () => Date,
 * }} input
 * @returns {Partial<CaseRow>}
 */
export function buildVoidTransition({
  currentUserId,
  reasonKey,
  note = '',
  now = () => new Date(),
}) {
  const written = note.trim();
  return {
    status: CASE_STATUS.VOID,
    voidReason: reasonKey,
    voidReasonNote: written === '' ? null : written,
    voidedAt: now().toISOString(),
    voidedBy: currentUserId,
    onHold: false,
    placedOnHoldAt: null,
    ...awaitingFrontlineCleared(),
  };
}
