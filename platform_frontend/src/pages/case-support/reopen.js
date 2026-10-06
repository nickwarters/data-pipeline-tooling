// @ts-check
import { h } from '../../lib/html.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';
import { formatDate } from '../../lib/format-datetime.js';
import { buildReopenTransition } from '../../evaluators/case-transitions.js';
import { isReportable } from '../../evaluators/case-lifecycle.js';
import { openAppealOf } from '../../evaluators/appeal-state.js';
import { runSupportAction } from '../../services/support-action.js';
import { formFooterView, reasonFieldView } from './form-parts.js';

/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../../sharepoint-client.js').SupportLogChange} SupportLogChange */
/** @typedef {import('../../services/support-action.js').SupportActionResult} SupportActionResult */

/**
 * The open Reopen form; `dueDate` is the date the review clock restarts at, worked out when the form opened.
 *
 * @typedef {{ reason: string, dueDate: string, saving: boolean, error: string | null }} ReopenForm
 */

/** @type {ReopenForm} */
export const EMPTY_REOPEN_FORM = Object.freeze({
  reason: '',
  dueDate: '',
  saving: false,
  error: null,
});

/**
 * Why this Case cannot be reopened, or `null` when it can.
 *
 * @param {CaseRow} row
 * @returns {string | null}
 */
export function reopenBlockedReason(row) {
  if (row.status === CASE_STATUS.VOID) {
    return 'A Void Case cannot be reopened.';
  }
  if (!isReportable(row.status)) {
    return 'Only a Case that has been completed or sent for remediation can be reopened.';
  }
  if (openAppealOf(row)) {
    return 'This Case has an open Appeal. Resolve it before reopening the Case.';
  }
  return null;
}

/**
 * What reopening this particular Case does, one line each, for the Maintainer to read before confirming.
 *
 * @param {CaseRow} row
 * @param {string} dueDate
 * @returns {string[]}
 */
export function reopenConsequences(row, dueDate) {
  const reviewer = row.assignedReviewer || 'its Reviewer';
  return [
    `The Case returns to In-progress with ${reviewer}.`,
    'The previous completion is kept as history on the Case.',
    'Every Answer and remediation status is kept.',
    ...(row.amendedOutcome
      ? [
          'The Amended Outcome is archived with the previous completion and must be amended again after the Case is completed.',
        ]
      : []),
    ...(row.status === CASE_STATUS.ACTIONS_IN_PROGRESS
      ? [
          "The Responsible Party's actions were already sent. They will be notified again when the actions are re-sent.",
        ]
      : []),
    `The Due Date restarts at ${formatDate(dueDate)}.`,
    row.questionBankVersion
      ? 'The Question Bank stays at the version the Case was reviewed against.'
      : 'The Case was completed before Question Bank versions were recorded, so it is reviewed against the current Question Bank.',
    'The Case leaves the completed counts in reports until it is completed again, and then counts on that date.',
  ];
}

/**
 * Each field the reopen changes, before and after; the history is logged by its length, since the other changes spell out the entry it gains.
 *
 * @param {CaseRow} row
 * @param {Partial<CaseRow>} fields
 * @returns {SupportLogChange[]}
 */
function reopenedFields(row, fields) {
  const current = /** @type {Record<string, unknown>} */ (row);
  return Object.entries(fields)
    .map(([field, after]) => {
      if (field !== 'previousCompletions') {
        return { field, before: current[field] ?? null, after };
      }
      const before = row.previousCompletions?.length ?? 0;
      return { field, before, after: before + 1 };
    })
    .filter(
      ({ before, after }) => JSON.stringify(before) !== JSON.stringify(after)
    );
}

/**
 * Return a reportable Case to In-progress in one guarded write, keeping its completion as history.
 *
 * @param {SharePointClient} client
 * @param {{
 *   row: CaseRow,
 *   listName: string,
 *   reason: string,
 *   reopenedBy: string,
 *   reviewSlaWorkingDays?: number,
 *   now?: () => Date,
 * }} request
 * @returns {Promise<SupportActionResult>}
 */
export function reopenCase(
  client,
  { row, listName, reason, reopenedBy, reviewSlaWorkingDays, now }
) {
  const fields = buildReopenTransition(row, {
    reopenedBy,
    reason,
    reviewSlaWorkingDays,
    now,
  });
  return runSupportAction(
    client,
    { row, action: 'reopen', reason, changes: reopenedFields(row, fields) },
    () => client.patchCase(row.id, fields, row.etag, { listName })
  );
}

/**
 * @param {ReopenForm} form
 * @param {CaseRow} row
 * @param {{
 *   onReason: (reason: string) => void,
 *   onSubmit: () => void,
 *   onCancel: () => void,
 * }} handlers
 * @returns {HTMLElement}
 */
export function reopenFormView(form, row, handlers) {
  return h(
    'section',
    {
      className: 'cora-case-support-form',
      'aria-labelledby': 'cora-case-support-form-title',
    },
    h('h2', { id: 'cora-case-support-form-title' }, 'Reopen the Case'),
    h(
      'ul',
      { className: 'cora-case-support-consequences' },
      ...reopenConsequences(row, form.dueDate).map((line) => h('li', {}, line))
    ),
    reasonFieldView(form, handlers.onReason),
    ...formFooterView(
      form,
      {
        label: 'Reopen',
        savingLabel: 'Reopening…',
        ready: form.reason.trim() !== '',
      },
      handlers
    )
  );
}
