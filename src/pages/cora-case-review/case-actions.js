// @ts-check

/** @typedef {import('../../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {'saved'|'saving'|'reconnecting'|'conflict'} SaveStatus */

/**
 * Route effect for Case persistence — Answers, the on-hold latch, and the plain
 * text fields of the Notes Section. User edits enter the store first, then the
 * unchanged SaveQueue owns field-level debounce and ETag concurrency.
 *
 * `caseId` is a getter, not a value: the effect is built in `start()`, before
 * the Case has loaded, and every write must address the row that was actually
 * loaded (#511).
 *
 * @param {{
 *   saveQueue: SaveQueue,
 *   caseId: () => string,
 *   dispatch: (action:
 *     | {type: 'case/answers-edited', answers: Record<string, Answer>}
 *     | {type: 'case/field-edited', field: string, value: string}
 *     | {type: 'case/on-hold-changed', onHold: boolean, placedOnHoldAt: string | null}
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
     * `caseJustification`.
     *
     * @param {string} field @param {string} value
     */
    fieldEdited(field, value) {
      dispatch({ type: 'case/field-edited', field, value });
      saveQueue.enqueue(caseId(), field, value);
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
