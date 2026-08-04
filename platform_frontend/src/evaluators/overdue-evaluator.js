// @ts-check
import { CASE_STATUS } from '../lib/case-statuses.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
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
 * review. The due date is read off the Case row — it is written when the Case
 * is created and never derived here from Case Type configuration, so no config
 * is needed to answer the question. `now` is injectable for testing.
 *
 * @param {CaseRow} caseRow
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isOverdue(caseRow, now = new Date()) {
  if (!OVERDUE_STATUSES.includes(caseRow.status)) return false;
  const due = caseRow.dueDate;
  if (!due) return false;
  return new Date(due) < now;
}

/**
 * Returns true when a Case is past the given remediation deadline and the
 * remediation is still outstanding. An absent deadline is never overdue, which
 * is what makes a Case with no Remediation Due Date read as having no
 * remediation clock rather than as being past one. `now` is injectable for
 * testing.
 *
 * Both callers now pass the row's own `remediationDueDate`, so the parameter is
 * redundant today; it is kept because this is the shared overdue definition and
 * narrowing its signature is a change to make deliberately, not in passing.
 *
 * @param {CaseRow} caseRow
 * @param {string | null} [deadline]
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isRemediationOverdue(caseRow, deadline, now = new Date()) {
  // A Case that has already left review has no clock left to breach, however
  // it left: a completed Case has nothing outstanding, and a voided one was
  // never held to its deadline in the first place.
  if (
    caseRow.status === CASE_STATUS.COMPLETED ||
    caseRow.status === CASE_STATUS.VOID
  ) {
    return false;
  }
  if (!deadline) return false;
  return new Date(deadline) < now;
}
