// @ts-check

/** @typedef {import('../../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../services/save-queue.js').SaveStatus} SaveStatus */

/**
 * Route effect for Case persistence — Answers, the on-hold latch and the
 * Responsible Party. User edits enter the store first, then the unchanged
 * SaveQueue owns field-level debounce and ETag concurrency.
 *
 * There is no generic Case Row field writer here any more. The Notes Section
 * persists its own two columns through the Section write seam, which checks
 * them against what that Section declared; a writer that took any field and a
 * type to keep it honest was the thing the seam replaced.
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
 *     | {type: 'case/on-hold-changed', onHold: boolean, placedOnHoldAt: string | null}
 *     | {type: 'case/responsible-party-changed', loginName: string, displayName: string}
 *     | {type: 'case/responsible-party-cleared'}
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
     * The Case-level Responsible Party — who the Remediation Actions are sent
     * to. Its own writer, and not something a Section may declare: access
     * resolution grants the Responsible Party Role by matching this field
     * against the current user, so it is read by exactly the frozen matrix
     * `status` and `assignedReviewer` are. Hence its own action and its own
     * reducer branches, which say in one place what a mid-session change does
     * and does not move.
     *
     * Only the account is persisted; it is the identity the Case is stored and
     * matched against. The display name travels with the action so the page can
     * name the person the moment they are chosen, and is re-read from the
     * directory with the Case rather than saved onto it.
     *
     * @param {string} loginName @param {string} displayName
     */
    responsiblePartyChanged(loginName, displayName) {
      dispatch({
        type: 'case/responsible-party-changed',
        loginName,
        displayName,
      });
      saveQueue.enqueue(caseId(), 'responsibleParty', loginName);
    },
    responsiblePartyCleared() {
      dispatch({ type: 'case/responsible-party-cleared' });
      saveQueue.enqueue(caseId(), 'responsibleParty', '');
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
