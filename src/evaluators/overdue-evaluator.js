// @ts-check
import { CASE_STATUS } from '../lib/case-statuses.js';

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
  if (caseRow.status === CASE_STATUS.COMPLETED) return false;
  const due = caseRow.dueDate;
  if (!due) return false;
  return new Date(due) < now;
}
