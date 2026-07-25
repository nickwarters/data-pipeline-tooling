// @ts-check

import { remediationComplete } from '../../evaluators/remediation-status.js';

/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/** @param {Record<string, Answer> | {answersSignal?: {get?: () => Record<string, Answer>}}} input */
export function hasRemediationActions(input) {
  const source = /** @type {any} */ (input);
  const answers = /** @type {Record<string, Answer>} */ (
    source.answersSignal?.get?.() ?? input
  );
  return Object.values(answers).some(
    (answer) => (answer.remediationActions?.length ?? 0) > 0
  );
}

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
    input.machine?.canCompleteRemediation === true &&
    remediationComplete(input.catalogue ?? [], input.answers)
  );
}

/**
 * Derive the one completion control from store state. The same CaseMachine
 * capability that permits the transition also controls whether the UI can
 * offer it.
 *
 * @param {{
 *   machine: import('../../lib/case-machine.js').CaseMachine | null,
 *   caseRow: import('../../sharepoint-client.js').CaseRow,
 *   catalogue: QuestionDefinition[],
 *   answers: Record<string, Answer>,
 *   allAnswered: boolean,
 * }} input
 */
export function completionControl(input) {
  const readyToSend =
    input.allAnswered &&
    input.machine?.canComplete === true &&
    !!input.caseRow.responsibleParty;
  const canClose = readyToClose(input);
  return {
    visible: readyToSend || canClose,
    label:
      !canClose && hasRemediationActions(input.answers)
        ? 'Send Actions'
        : 'Complete Case',
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
  if (machine.canCompleteRemediation) {
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
  const transition = hasRemediationActions(input.answers)
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
    location.hash = '#/dashboard';
  }
  return result.ok;
}
