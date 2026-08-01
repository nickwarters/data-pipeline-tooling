// @ts-check
import { CASE_STATUS } from '../lib/case-statuses.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../lib/case-statuses.js').CaseStatus} CaseStatus */

/**
 * This module is the one definition of "overdue" — every surface that badges,
 * filters or counts an overdue Case asks here, so a screen and the query behind
 * it cannot disagree.
 *
 * A Case is overdue when its review due date has passed while the review is
 * still running, i.e. the Case is not yet Reportable. "Not yet Reportable" is
 * spelled as a status allow-list rather than as a `reportableAt` timestamp
 * check because legacy rows written before `reportableAt` existed carry a null
 * column.
 */

/**
 * The Case statuses in which the review due date is still running. An
 * allow-list rather than "anything but Completed", so a status added later has
 * to be considered rather than silently inheriting the review clock.
 *
 * @type {readonly CaseStatus[]}
 */
export const OVERDUE_STATUSES = Object.freeze([CASE_STATUS.IN_PROGRESS]);

/**
 * Returns true when a Case is past its review due date while still under
 * review. `now` is injectable for testing.
 *
 * @param {CaseRow} caseRow
 * @param {Partial<CaseTypeConfig>} [_caseTypeConfig]
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isOverdue(caseRow, _caseTypeConfig, now = new Date()) {
  if (!OVERDUE_STATUSES.includes(caseRow.status)) return false;
  const due = caseRow.dueDate;
  if (!due) return false;
  return new Date(due) < now;
}

/**
 * Returns true when a Case is past the given remediation deadline and the
 * remediation is still outstanding; the deadline is passed in rather than read
 * off the row because some surfaces track a fallback date. `now` is injectable
 * for testing.
 *
 * @param {CaseRow} caseRow
 * @param {string | null} [deadline]
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isRemediationOverdue(caseRow, deadline, now = new Date()) {
  if (caseRow.status === CASE_STATUS.COMPLETED) return false;
  if (!deadline) return false;
  return new Date(deadline) < now;
}
