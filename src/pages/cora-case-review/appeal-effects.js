// @ts-check
import { amendOutcome, raiseAppeal, resolveAppeal } from './appeal-actions.js';

/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../services/save-queue.js').SaveQueue} SaveQueue */

/**
 * The route snapshot, as much of it as these effects care about: the viewer the
 * transition is attributed to. Everything else is carried through untouched to
 * the `case/model-changed` dispatch, so it stays open.
 *
 * @typedef {{ currentUser?: { id: string } | null } & Record<string, any>} Snapshot
 */

/**
 * Route effects for the ADR-0027 Appeal and ADR-0026 Amended Outcome
 * transitions. `appeal-actions.js` holds the pure half — it takes `at` /
 * `amendedAt` as arguments and never reaches a clock or the SaveQueue; this is
 * the persistence half that used to sit inline in the page's render function.
 *
 * Both the clock and the id minter are injected, because everything these
 * effects write is persisted and audit-relevant: a test can assert the exact
 * Appeal id and timestamp that reach the queue without freezing the global
 * clock (#511).
 *
 * @param {{
 *   saveQueue: SaveQueue,
 *   caseId: () => string,
 *   dispatch: (action: {type: 'case/model-changed', snapshot: Snapshot}) => unknown,
 *   onCaseRow: (caseRow: CaseRow) => unknown,
 *   now?: () => Date,
 *   newId?: (prefix: string) => string,
 * }} input
 */
export function createAppealEffects({
  saveQueue,
  caseId,
  dispatch,
  onCaseRow,
  now = () => new Date(),
  newId = (prefix) => `${prefix}-${now().getTime()}`,
}) {
  /**
   * Who the transition is attributed to. Every one of these fields is
   * persisted, so an unresolved viewer records an empty author rather than
   * `undefined`.
   *
   * @param {Snapshot} snapshot
   */
  const viewer = (snapshot) => snapshot.currentUser?.id ?? '';

  /**
   * Every transition ends the same way: the loaded row is replaced in place and
   * the store is told about it, so the page re-renders from the new Case row
   * without a reload.
   *
   * @param {{ caseRow: CaseRow }} result
   * @param {Snapshot} snapshot
   */
  function applied(result, snapshot) {
    onCaseRow(result.caseRow);
    dispatch({
      type: 'case/model-changed',
      snapshot: { ...snapshot, caseRow: result.caseRow },
    });
  }

  return {
    /**
     * @param {{
     *   caseRow: CaseRow,
     *   snapshot: Snapshot,
     *   rationale: string,
     *   citedAnswerKeys: string[],
     * }} input
     */
    raise({ caseRow, snapshot, rationale, citedAnswerKeys }) {
      const result = raiseAppeal({
        caseRow,
        appellant: viewer(snapshot),
        rationale,
        citedAnswerKeys,
        id: newId('appeal'),
        at: now().toISOString(),
      });
      saveQueue.enqueue(caseId(), 'appeals', result.appeals);
      applied(result, snapshot);
    },

    /**
     * @param {{
     *   caseRow: CaseRow,
     *   snapshot: Snapshot,
     *   resolution: {
     *     appealId: string,
     *     verdict: 'agreed'|'rejected',
     *     rationale: string,
     *     outcome?: string,
     *     justification?: string,
     *   },
     * }} input
     */
    resolve({ caseRow, snapshot, resolution }) {
      const result = resolveAppeal({
        caseRow,
        resolver: viewer(snapshot),
        at: now().toISOString(),
        ...resolution,
      });
      // Load-bearing fork, moved verbatim: agreeing writes the appeal *and*
      // the linked ADR-0019 corrected-reporting columns, which must land as one
      // atomic PATCH or `effectiveOutcome` / `effectiveHadRemediation` /
      // `outcomeOverridden` can desync (save-queue.js documents why).
      if (result.transactional) {
        saveQueue.enqueueFields(caseId(), result.fields);
      } else {
        saveQueue.enqueue(caseId(), 'appeals', result.fields.appeals);
      }
      applied(result, snapshot);
    },

    /**
     * @param {{
     *   caseRow: CaseRow,
     *   snapshot: Snapshot,
     *   outcome: string,
     *   justification: string,
     * }} input
     */
    amend({ caseRow, snapshot, outcome, justification }) {
      const result = amendOutcome({
        caseRow,
        outcome,
        justification,
        amendedBy: viewer(snapshot),
        amendedAt: now().toISOString(),
      });
      saveQueue.enqueueFields(caseId(), result.fields);
      applied(result, snapshot);
    },
  };
}
