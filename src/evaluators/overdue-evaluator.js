// @ts-check
// TODO(simplify-ui): Preserve this as a pure function/data boundary for the
// simplified component model. Function components should pass data in and
// render results with h(); evaluator modules should stay free of DOM, lifecycle,
// or framework concerns.

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */

/**
 * Returns true when a Case is past its due date and not yet completed.
 * `now` is injectable for testing.
 *
 * @param {CaseRow} caseRow
 * @param {Partial<CaseTypeConfig>} [_caseTypeConfig]
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isOverdue(caseRow, _caseTypeConfig, now = new Date()) {
  if (caseRow.status === 'Completed') return false;
  const due = caseRow.dueDate;
  if (!due) return false;
  return new Date(due) < now;
}
