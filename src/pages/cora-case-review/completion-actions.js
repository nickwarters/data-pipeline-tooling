// @ts-check

/** @typedef {import('../../sharepoint-client.js').Answer} Answer */

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
 * Derive the one completion control from store state. The same CaseMachine
 * capability that permits the transition also controls whether the UI can
 * offer it.
 *
 * @param {{
 *   machine: import('../../lib/case-machine.js').CaseMachine | null,
 *   caseRow: import('../../sharepoint-client.js').CaseRow,
 *   answers: Record<string, Answer>,
 *   allAnswered: boolean,
 * }} input
 */
export function completionControl(input) {
  const readyToSend =
    input.allAnswered &&
    input.machine?.canComplete === true &&
    !!input.caseRow.responsibleParty;
  const readyToClose = input.machine?.canCompleteRemediation === true;
  return {
    visible: readyToSend || readyToClose,
    label:
      !readyToClose && hasRemediationActions(input.answers)
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
    return machine.transitionToFinalComplete?.() ?? null;
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
