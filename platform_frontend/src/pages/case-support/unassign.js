// @ts-check
import { h } from '../../lib/html.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';
import { buildUnassignTransition } from '../../evaluators/case-transitions.js';
import { runSupportAction } from '../../services/support-action.js';
import { formFooterView, reasonFieldView } from './form-parts.js';

/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../../sharepoint-client.js').SupportLogChange} SupportLogChange */
/** @typedef {import('../../services/support-action.js').SupportActionResult} SupportActionResult */

/** @typedef {{ reason: string, saving: boolean, error: string | null }} UnassignForm */

/** @type {UnassignForm} */
export const EMPTY_UNASSIGN_FORM = Object.freeze({
  reason: '',
  saving: false,
  error: null,
});

/**
 * Why this Case cannot be un-assigned, or `null` when it can.
 *
 * @param {CaseRow} row
 * @returns {string | null}
 */
export function unassignBlockedReason(row) {
  if (row.status === CASE_STATUS.TO_ALLOCATE) {
    return 'This Case is already waiting to be claimed.';
  }
  if (row.status !== CASE_STATUS.IN_PROGRESS) {
    return 'Only an In-progress Case can be un-assigned.';
  }
  return null;
}

/**
 * Each field the release changes, with `assignedAt`, which the write clears alongside the Reviewer.
 *
 * @param {CaseRow} row
 * @param {Partial<CaseRow>} fields
 * @returns {SupportLogChange[]}
 */
function releasedFields(row, fields) {
  const written = { ...fields, assignedAt: null };
  const current = /** @type {Record<string, unknown>} */ (row);
  return Object.entries(written)
    .map(([field, after]) => ({ field, before: current[field] ?? null, after }))
    .filter(({ before, after }) => (before || null) !== (after || null));
}

/**
 * Return an In-progress Case to To-allocate in one guarded write, so it can be claimed again.
 *
 * @param {SharePointClient} client
 * @param {{ row: CaseRow, listName: string, reason: string }} request
 * @returns {Promise<SupportActionResult>}
 */
export function unassignCase(client, { row, listName, reason }) {
  const fields = buildUnassignTransition();
  return runSupportAction(
    client,
    { row, action: 'unassign', reason, changes: releasedFields(row, fields) },
    () => client.patchCase(row.id, fields, row.etag, { listName })
  );
}

/**
 * @param {UnassignForm} form
 * @param {string} reviewer
 * @param {{
 *   onReason: (reason: string) => void,
 *   onSubmit: () => void,
 *   onCancel: () => void,
 * }} handlers
 * @returns {HTMLElement}
 */
export function unassignFormView(form, reviewer, handlers) {
  return h(
    'section',
    {
      className: 'cora-case-support-form',
      'aria-labelledby': 'cora-case-support-form-title',
    },
    h('h2', { id: 'cora-case-support-form-title' }, 'Un-assign the Case'),
    h(
      'p',
      { className: 'cora-case-support-note' },
      `The Case leaves ${reviewer} and returns to To-allocate, to be claimed again. Its Reviewer, Reviewer Manager, assignment time, Due Date and any hold are cleared; the Answers entered so far are kept.`
    ),
    reasonFieldView(form, handlers.onReason),
    ...formFooterView(
      form,
      {
        label: 'Un-assign',
        savingLabel: 'Un-assigning…',
        ready: form.reason.trim() !== '',
      },
      handlers
    )
  );
}
