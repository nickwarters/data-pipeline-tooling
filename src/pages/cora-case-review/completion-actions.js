// @ts-check

import {
  hasTrackableRemediation,
  remediationComplete,
} from '../../evaluators/remediation-status.js';
import { navigateTo } from '../../lib/navigate.js';

/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/**
 * The final-complete gate on the actions path: the Assigned Reviewer may close
 * an `Actions In Progress` Case only when every Question carrying remediation
 * has been resolved on the Remediation tab — `complete`, or `partial`/`cancelled`
 * with the details / justification each requires (#499). The permission half
 * comes from CaseMachine; the content half is computed here, from the store's
 * live catalogue and Answers, so resolving the last row enables the button
 * immediately.
 *
 * @param {{
 *   machine: import('../../lib/case-machine.js').CaseMachine | null,
 *   catalogue: QuestionDefinition[],
 *   answers: Record<string, Answer>,
 * }} input
 * @returns {boolean}
 */
export function readyToClose(input) {
  return (
    input.machine?.mayResolveRemediation === true &&
    remediationComplete(input.catalogue ?? [], input.answers)
  );
}

/** The gate's wording, shown wherever the completion control appears (#499). */
export const REMEDIATION_GATE_REASON =
  'Record an outcome for every remediation on the Remediation tab — with the details or justification required — before this Case can be completed.';

/**
 * Derive the one completion control from store state. The same CaseMachine
 * capability that permits the transition also controls whether the UI can
 * offer it.
 *
 * While remediation is outstanding the Assigned Reviewer sees the button
 * **disabled with its reason** rather than not at all: hiding it left the gate
 * legible only to a Reviewer who happened to open the Remediation tab, and from
 * every other tab the feature simply looked absent (#499). A viewer without the
 * permission half still sees nothing — the disabled button is the Reviewer's
 * gate, not a notice board.
 *
 * @param {{
 *   machine: import('../../lib/case-machine.js').CaseMachine | null,
 *   caseRow: import('../../sharepoint-client.js').CaseRow,
 *   catalogue: QuestionDefinition[],
 *   answers: Record<string, Answer>,
 *   allAnswered: boolean,
 * }} input
 * @returns {{ visible: boolean, disabled: boolean, label: string, reason: string | null }}
 */
export function completionControl(input) {
  const readyToSend =
    input.allAnswered &&
    input.machine?.canComplete === true &&
    !!input.caseRow.responsibleParty;
  const canClose = readyToClose(input);
  // Permission to close without the content half: the actions have been sent and
  // this viewer resolves them, but at least one row is still outstanding.
  const gated = input.machine?.mayResolveRemediation === true && !canClose;
  return {
    visible: readyToSend || canClose || gated,
    disabled: gated,
    // Once the actions are sent there is nothing left to send, so the label is
    // the close either way; before that, remediation makes it the send.
    // "Carries remediation" is `hasTrackableRemediation` — literally "the
    // Remediation tab has ≥1 row" — so free-form text the Reviewer typed counts
    // exactly as a ticked action does (#502), and remediation stranded on a
    // Question that has left the catalogue counts as neither, because there
    // would be no row on which to resolve it.
    label:
      input.machine?.mayResolveRemediation !== true &&
      hasTrackableRemediation(input.catalogue, input.answers)
        ? 'Send Actions'
        : 'Complete Case',
    reason: gated ? REMEDIATION_GATE_REASON : null,
  };
}

/**
 * Ask CaseMachine for the only valid patch from the current state. There is
 * deliberately no fallback transition: an absent transition means the UI
 * cannot mutate the lifecycle.
 *
 * @param {{
 *   machine: import('../../lib/case-machine.js').CaseMachine | null,
 *   caseRow: import('../../sharepoint-client.js').CaseRow,
 *   catalogue: QuestionDefinition[],
 *   answers: Record<string, Answer>,
 *   allAnswered: boolean,
 *   computeOutcome: (answers: Record<string, Answer>) => import('../../sharepoint-client.js').OutcomeResult,
 *   exportHash: string | null,
 * }} input
 * @returns {Partial<import('../../sharepoint-client.js').CaseRow> | null}
 */
export function completionPatch(input) {
  const machine = input.machine;
  if (!machine) return null;
  if (machine.mayResolveRemediation) {
    return readyToClose(input)
      ? (machine.transitionToFinalComplete?.() ?? null)
      : null;
  }
  if (
    !input.allAnswered ||
    !input.caseRow.responsibleParty ||
    !machine.canComplete
  ) {
    return null;
  }
  const transition = hasTrackableRemediation(input.catalogue, input.answers)
    ? machine.transitionToActionsInProgress
    : machine.transitionToCompleted;
  const transitionFields =
    transition?.call(
      machine,
      input.computeOutcome,
      input.answers,
      input.exportHash
    ) ?? null;
  if (!transitionFields) return null;
  return input.caseRow.onHold === true
    ? { ...transitionFields, onHold: false, placedOnHoldAt: null }
    : transitionFields;
}

/**
 * Flush autosaves, then persist the CaseMachine-owned transition using the
 * queue's current ETag. The transition already contains the frozen Outcome and
 * bank version fields required by ADR-0012/0021.
 *
 * @param {{
 *   caseId: string,
 *   client: import('../../sharepoint-client.js').SharePointClient | null,
 *   saveQueue: import('../../services/save-queue.js').SaveQueue | null,
 *   patchFields: Partial<import('../../sharepoint-client.js').CaseRow> | null,
 *   caseListOptions?: import('../../sharepoint-client.js').CaseListOptions,
 *   opts?: import('../../sharepoint-client.js').CaseListOptions,
 * }} input
 */
export async function completeCase(input) {
  if (!input.client || !input.saveQueue || !input.patchFields) return false;
  if (!(await input.saveQueue.flushCase(input.caseId))) return false;
  const result = await input.client.patchCase(
    input.caseId,
    input.patchFields,
    input.saveQueue.getEtag(input.caseId),
    input.caseListOptions ?? input.opts ?? {}
  );
  if (result.ok && typeof location !== 'undefined') {
    navigateTo('#/dashboard');
  }
  return result.ok;
}
