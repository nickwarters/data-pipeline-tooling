// @ts-check
/**
 * Shared writer for the Action Centre **state** reason flags (the architecture decision §2,
 * the Action Centre worklist.
 *
 * the architecture decision splits the Action Centre reasons into time-derived facts (computed on
 * read — `overdue`, day counts) and genuine **states** that only change on an
 * explicit lifecycle transition. The state reasons are stored as plain indexed
 * `Yes/No` columns paired with a `DateTime` clock, and **the app is the sole
 * writer**: each must be set/cleared when its transition happens, in the same
 * field-level `SaveQueue` PATCH as the transition.
 *
 * The ADR calls out the risk that a missed write leaves a stale flag. This module
 * is the single mitigation: every transition handler routes its flag+clock write
 * through {@link reasonFlagFields} (merged into its own patch) or
 * {@link writeReasonFlag} (the flag alone), so the flag pair can never be
 * forgotten or spelled two different ways.
 *
 * @typedef {import('../sharepoint-client.js').CaseRow} CaseRow
 */

/**
 * The four app-written state reasons and their plain columns. `flag` is the
 * indexed `Yes/No` column; `clock` is its paired `DateTime` column, or `null`
 * for Review Required, whose age is measured from the built-in `created` column
 * (never app-written).
 *
 * @typedef {'awaitingFrontline' | 'appeals' | 'reopened' | 'reviewRequired'} StateReason
 * @type {Record<StateReason, { flag: keyof CaseRow, clock: (keyof CaseRow) | null }>}
 */
export const STATE_REASON_FLAGS = {
  awaitingFrontline: {
    flag: 'awaitingResponsibleParty',
    clock: 'awaitingSince',
  },
  appeals: { flag: 'hasOpenAppeal', clock: 'appealRaisedAt' },
  reopened: { flag: 'reopened', clock: 'reopenedAt' },
  reviewRequired: { flag: 'reviewRequired', clock: null },
};

/**
 * The field patch that sets or clears one state reason's flag + clock pair.
 * Setting stamps the clock (`at`, defaulting to now); clearing nulls it. Review
 * Required has no writable clock, so only its flag is emitted.
 *
 * Returns a `Partial<CaseRow>` a transition handler spreads into its own
 * field-level PATCH, so the flag write rides the *same* `SaveQueue` transaction
 * as the transition.
 *
 * @param {StateReason} reason
 * @param {boolean} active
 * @param {string} [at]
 * @returns {Partial<CaseRow>}
 */
export function reasonFlagFields(
  reason,
  active,
  at = new Date().toISOString()
) {
  const cols = STATE_REASON_FLAGS[reason];
  if (!cols) throw new Error(`Unknown state reason: ${reason}`);
  /** @type {Record<string, unknown>} */
  const fields = { [cols.flag]: active };
  if (cols.clock) fields[cols.clock] = active ? at : null;
  return /** @type {Partial<CaseRow>} */ (fields);
}

/**
 * Route a lone state-flag write through the `SaveQueue` (the architecture decision field-level
 * PATCH). Prefer merging {@link reasonFlagFields} into a transition's own
 * `enqueueFields` when the transition also mutates other columns; use this
 * helper when the flag pair is the only write.
 *
 * @param {import('./save-queue.js').SaveQueue} saveQueue
 * @param {string} caseId
 * @param {StateReason} reason
 * @param {boolean} active
 * @param {string} [at]
 */
export function writeReasonFlag(saveQueue, caseId, reason, active, at) {
  saveQueue.enqueueFields(caseId, reasonFlagFields(reason, active, at));
}
