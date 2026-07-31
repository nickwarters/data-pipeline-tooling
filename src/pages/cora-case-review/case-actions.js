// @ts-check

/** @typedef {import('../../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {'saved'|'saving'|'reconnecting'|'conflict'} SaveStatus */

/**
 * The plain-text Case Row fields the Notes Section edits, and the **only**
 * fields `fieldEdited` may write.
 *
 * A closed union rather than `string` on purpose. `fieldEdited` is the one
 * generic Case Row writer, so a caller passing `status` or `assignedReviewer`
 * would advance `snapshot.caseRow` while `snapshot.machine` kept the copy of the
 * row it was constructed with at load. Every `machine.can*` guard reads exactly
 * those two fields, so the store would show the new value while completion,
 * capture, attribution and Remediation selection answered from the old one. The
 * reducer branch ignores anything else, so a raw dispatch cannot route around
 * the type.
 *
 * Lifecycle fields have their own writer: `CaseMachine`'s transitions, persisted
 * by `completeCase` and folded back in through `case/case-row-patched`.
 *
 * `responsibleParty` is a plain-text Case Row field too, and is still not one of
 * these. Access resolution grants the Responsible Party Role by matching that
 * field against the current user, so it is read by exactly the same frozen
 * matrix `status` and `assignedReviewer` are — hence `responsiblePartyChanged`,
 * its own action, and its own reducer branch that says in one place what a
 * mid-session change does and does not move.
 *
 * @typedef {'notes' | 'caseJustification'} PlainTextCaseField
 */

/**
 * Route effect for Case persistence — Answers, the on-hold latch, and the plain
 * text fields of the Notes Section. User edits enter the store first, then the
 * unchanged SaveQueue owns field-level debounce and ETag concurrency.
 *
 * `caseId` is a getter, not a value: the effect is built with the route, before
 * the Case has loaded, and every write must address the row that was actually
 * loaded.
 *
 * @param {{
 *   saveQueue: SaveQueue,
 *   caseId: () => string,
 *   dispatch: (action:
 *     | {type: 'case/answers-edited', answers: Record<string, Answer>}
 *     | {type: 'case/field-edited', field: PlainTextCaseField, value: string}
 *     | {type: 'case/on-hold-changed', onHold: boolean, placedOnHoldAt: string | null}
 *     | {type: 'case/responsible-party-changed', loginName: string}
 *   ) => unknown,
 *   now?: () => Date,
 * }} input
 */
export function createCaseReviewSaveEffect({
  saveQueue,
  caseId,
  dispatch,
  now = () => new Date(),
}) {
  return {
    /** @param {Record<string, Answer>} answers */
    answersEdited(answers) {
      dispatch({ type: 'case/answers-edited', answers });
      saveQueue.enqueue(caseId(), 'answers', answers);
    },
    /**
     * A plain-text Case field edited in the Notes Section — `notes` or
     * `caseJustification`, and nothing else. See `PlainTextCaseField` for why
     * the parameter is a closed union rather than a `string`.
     *
     * @param {PlainTextCaseField} field @param {string} value
     */
    fieldEdited(field, value) {
      dispatch({ type: 'case/field-edited', field, value });
      saveQueue.enqueue(caseId(), field, value);
    },
    /**
     * The Case-level Responsible Party — who the Remediation Actions are sent
     * to. Its own writer rather than a `fieldEdited` call: see
     * `PlainTextCaseField` for why that union stays shut.
     *
     * @param {string} loginName
     */
    responsiblePartyChanged(loginName) {
      dispatch({ type: 'case/responsible-party-changed', loginName });
      saveQueue.enqueue(caseId(), 'responsibleParty', loginName);
    },
    /** @param {boolean} onHold */
    onHoldChanged(onHold) {
      const placedOnHoldAt = onHold ? now().toISOString() : null;
      dispatch({
        type: 'case/on-hold-changed',
        onHold,
        placedOnHoldAt,
      });
      saveQueue.enqueueFields(caseId(), { onHold, placedOnHoldAt });
    },
  };
}

/**
 * Bridge SaveQueue status transitions into route-owned state. Views consume
 * only the dispatched status value and do not depend on the queue internals.
 *
 * @param {SaveQueue} saveQueue
 * @param {(action: {type: 'case/save-status-changed', status: SaveStatus}) => unknown} dispatch
 * @returns {() => void}
 */
export function observeSaveStatus(saveQueue, dispatch) {
  return saveQueue.subscribeStatus((status) => {
    dispatch({
      type: 'case/save-status-changed',
      status,
    });
  });
}
