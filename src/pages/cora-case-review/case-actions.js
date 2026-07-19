// @ts-check

/** @typedef {import('../../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {'saved'|'saving'|'reconnecting'|'conflict'} SaveStatus */

/**
 * Route effect for Answer persistence. User edits enter the store first, then
 * the unchanged SaveQueue owns field-level debounce and ETag concurrency.
 *
 * @param {{
 *   saveQueue: SaveQueue,
 *   caseId: string,
 *   dispatch: (action: {type: 'case/answers-edited', answers: Record<string, Answer>}) => unknown,
 * }} input
 */
export function createCaseReviewSaveEffect({ saveQueue, caseId, dispatch }) {
  return {
    /** @param {Record<string, Answer>} answers */
    answersEdited(answers) {
      dispatch({ type: 'case/answers-edited', answers });
      saveQueue.enqueue(caseId, 'answers', answers);
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
