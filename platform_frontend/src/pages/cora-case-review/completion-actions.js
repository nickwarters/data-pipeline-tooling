// @ts-check

import { unfilledRequiredCapture } from '../../evaluators/issue-capture.js';
import {
  anyRemediationRequired,
  hasTrackableRemediation,
  remediationComplete,
  remediationDecided,
} from '../../evaluators/remediation-status.js';
import { navigateTo } from '../../lib/navigate.js';

/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/**
 * The final-complete gate on the actions path: the Assigned Reviewer may close
 * an `Actions In Progress` Case only when every Question carrying remediation
 * has been resolved on the Remediation tab — `complete`, or `partial`/`cancelled`
 * with the details / justification each requires. The permission half
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
    remediationComplete(input.catalogue, input.answers)
  );
}

/** The gate's wording, shown wherever the completion control appears. */
const REMEDIATION_GATE_REASON =
  'Record an outcome for every remediation on the Remediation tab — with the details or justification required — before this Case can be completed.';

/** The pre-send gate's wording: the decision, before anything can be sent. */
const REMEDIATION_DECISION_REASON =
  'Answer "Is remediation required?" on every failed Question on the Issues tab, and record at least one action or free-form remediation wherever the answer is Yes.';

/** The pre-send gate on configured capture: what the Case Type insists on. */
const REQUIRED_CAPTURE_REASON =
  'Fill in every required field on each failed Question on the Issues tab before this Case can go any further.';

/** The other pre-send gate's wording: the named party, actions or no actions. */
const RESPONSIBLE_PARTY_REASON =
  'Name a Responsible Party at the foot of the Issues tab before this Case can go any further.';

/**
 * Whether the Case still owes a Responsible Party. Gated on the same condition
 * that renders the field, so the button is never disabled against a reason
 * pointing at a control that is not on the page.
 *
 * @param {{
 *   caseRow: import('../../sharepoint-client.js').CaseRow,
 *   catalogue: QuestionDefinition[],
 *   answers: Record<string, Answer>,
 * }} input
 * @returns {boolean}
 */
function missingResponsibleParty(input) {
  return (
    !input.caseRow.responsibleParty &&
    anyRemediationRequired(input.catalogue, input.answers)
  );
}

/**
 * Derive the one completion control from store state. The same CaseMachine
 * capability that permits the transition also controls whether the UI can
 * offer it.
 *
 * While remediation is outstanding the Assigned Reviewer sees the button
 * **disabled with its reason** rather than not at all: hiding it left the gate
 * legible only to a Reviewer who happened to open the Remediation tab, and from
 * every other tab the feature simply looked absent. An unnamed Responsible
 * Party is the same kind of gate and is shown the same way, rather than leaving
 * a Reviewer who has answered everything with no button and no reason. A viewer
 * without the permission half still sees nothing — the disabled button is the
 * Reviewer's gate, not a notice board.
 *
 * @param {{
 *   machine: import('../../lib/case-machine.js').CaseMachine | null,
 *   caseRow: import('../../sharepoint-client.js').CaseRow,
 *   catalogue: QuestionDefinition[],
 *   answers: Record<string, Answer>,
 *   allAnswered: boolean,
 *   captureGroups: import('../../sharepoint-client.js').CaptureGroup[],
 * }} input
 * @returns {{ visible: boolean, disabled: boolean, label: string, reason: string | null }}
 */
export function completionControl(input) {
  const readyToSend = input.allAnswered && input.machine?.canComplete === true;
  const canClose = readyToClose(input);
  // Permission to close without the content half: the actions have been sent and
  // this viewer resolves them, but at least one row is still outstanding.
  const gated = input.machine?.mayResolveRemediation === true && !canClose;
  // The pre-send half of the same idea: the Reviewer may complete, but has not
  // yet said whether each failure needs remediation. Only that path can be held
  // this way, so the walk is skipped entirely once the actions are sent.
  const undecided =
    readyToSend && !remediationDecided(input.catalogue, input.answers);
  // Independent of that decision: a required Issue Capture Field is asked of
  // every failure, whether or not it needs remediation. The Case-level
  // Responsible Party is the last of the three, named at the foot of the tab.
  const unfilledCapture =
    readyToSend &&
    unfilledRequiredCapture(
      input.catalogue,
      input.answers,
      input.captureGroups
    );
  const missingParty = readyToSend && missingResponsibleParty(input);
  return {
    visible: readyToSend || canClose || gated,
    disabled: gated || undecided || unfilledCapture || missingParty,
    // Once the actions are sent there is nothing left to send, so the label is
    // the close either way; before that, remediation makes it the send.
    // "Carries remediation" is `hasTrackableRemediation` — literally "the
    // Remediation tab has ≥1 row" — so free-form text the Reviewer typed counts
    // exactly as a ticked action does, and remediation stranded on a
    // Question that has left the catalogue counts as neither, because there
    // would be no row on which to resolve it.
    label:
      input.machine?.mayResolveRemediation !== true &&
      hasTrackableRemediation(input.catalogue, input.answers)
        ? 'Send Actions'
        : 'Complete Case',
    reason: gated
      ? REMEDIATION_GATE_REASON
      : undecided
        ? REMEDIATION_DECISION_REASON
        : unfilledCapture
          ? REQUIRED_CAPTURE_REASON
          : missingParty
            ? RESPONSIBLE_PARTY_REASON
            : null,
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
 *   captureGroups: import('../../sharepoint-client.js').CaptureGroup[],
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
    missingResponsibleParty(input) ||
    !machine.canComplete ||
    !remediationDecided(input.catalogue, input.answers) ||
    unfilledRequiredCapture(input.catalogue, input.answers, input.captureGroups)
  ) {
    return null;
  }
  // Read the machine's catalogue, not the caller's. `CaseMachine` stamps
  // `hadRemediation` from `this.catalogue`, so choosing the transition from any
  // other copy would be the same fact read twice — the exact split this change
  // exists to close. Today both are the one `CaseLoader` catalogue and
  // the two readings cannot differ; sourcing them from one object is what keeps
  // that true rather than incidental.
  const transition = hasTrackableRemediation(machine.catalogue, input.answers)
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
 * queue's current ETag, and leave the Case behind. Nothing here is specific to
 * one transition — sending actions, completing and voiding all end this way —
 * so it is named for what it does rather than for which lifecycle step called
 * it. The transition itself carries whatever fields it stamps.
 *
 * @param {{
 *   caseId: string,
 *   client: import('../../sharepoint-client.js').SharePointClient | null,
 *   saveQueue: import('../../services/save-queue.js').SaveQueue | null,
 *   patchFields: Partial<import('../../sharepoint-client.js').CaseRow> | null,
 *   caseListOptions?: import('../../sharepoint-client.js').CaseListOptions,
 *   opts?: import('../../sharepoint-client.js').CaseListOptions,
 *   navigate?: (hash: string) => void,
 * }} input `navigate` is where a successful write goes next. Defaults to
 *   the `lib/navigate.js` seam so no page call site has to pass it; injectable
 *   so a non-browser caller — `tests/_in-memory-flow-runner.js` drives real
 *   completions in Node — can record the navigation instead of this action
 *   sniffing for a `location` global.
 */
export async function closeCase({
  caseId,
  client,
  saveQueue,
  patchFields,
  caseListOptions,
  opts,
  navigate = navigateTo,
}) {
  if (!client || !saveQueue || !patchFields) return false;
  if (!(await saveQueue.flushCase(caseId))) return false;
  const result = await client.patchCase(
    caseId,
    patchFields,
    saveQueue.getEtag(caseId),
    caseListOptions ?? opts ?? {}
  );
  if (result.ok) navigate('#/dashboard');
  return result.ok;
}
