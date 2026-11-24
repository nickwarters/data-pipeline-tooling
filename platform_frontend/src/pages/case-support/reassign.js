// @ts-check
import { h } from '../../lib/html.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';
import { EmptyState, LoadingState } from '../../lib/empty-state.js';
import { resolveReviewerManager } from '../../services/reviewer-manager.js';
import { runSupportAction } from '../../services/support-action.js';
import { formFooterView, reasonFieldView } from './form-parts.js';

/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').PersonResult} PersonResult */
/** @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../../services/support-action.js').SupportActionResult} SupportActionResult */

/**
 * The open Reassign form; `candidates` is `undefined` while the reviewer group is read.
 *
 * @typedef {{
 *   candidates: PersonResult[] | undefined,
 *   candidatesError: string | null,
 *   reviewer: string,
 *   reason: string,
 *   saving: boolean,
 *   error: string | null,
 * }} ReassignForm
 */

/** @type {ReassignForm} */
export const EMPTY_REASSIGN_FORM = Object.freeze({
  candidates: undefined,
  candidatesError: null,
  reviewer: '',
  reason: '',
  saving: false,
  error: null,
});

/**
 * Why this Case's Reviewer cannot be reassigned, or `null` when it can.
 *
 * @param {CaseRow} row
 * @returns {string | null}
 */
export function reassignBlockedReason(row) {
  if (row.status === CASE_STATUS.VOID) {
    return 'A Void Case cannot be reassigned.';
  }
  if (row.status === CASE_STATUS.TO_ALLOCATE || !row.assignedReviewer) {
    return 'This Case has no Reviewer yet; it is claimed from the pot.';
  }
  return null;
}

/**
 * The reviewer group's members a Case can move to: everyone but its current Reviewer, by name.
 *
 * @param {PersonResult[]} members
 * @param {CaseRow} row
 * @returns {PersonResult[]}
 */
export function reviewerCandidates(members, row) {
  const current = String(row.assignedReviewer ?? '').toLowerCase();
  return members
    .filter((person) => person.loginName.toLowerCase() !== current)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Move a Case to another Reviewer, restamping the assignment and its recorded and current manager in one guarded write.
 *
 * @param {SharePointClient} client
 * @param {{ row: CaseRow, listName: string, reviewer: string, reason: string }} request
 * @returns {Promise<SupportActionResult>}
 */
export async function reassignCase(
  client,
  { row, listName, reviewer, reason }
) {
  const manager = await resolveReviewerManager(client, reviewer);
  return runSupportAction(
    client,
    {
      row,
      action: 'reassign',
      reason,
      changes: [
        {
          field: 'assignedReviewer',
          before: row.assignedReviewer || null,
          after: reviewer,
        },
        {
          field: 'assignedReviewerManager',
          before: row.assignedReviewerManager ?? null,
          after: manager,
        },
        {
          field: 'currentReviewerManager',
          before: row.currentReviewerManager ?? null,
          after: manager,
        },
      ],
    },
    () =>
      client.patchCase(
        row.id,
        { assignedReviewer: reviewer, assignedReviewerManager: manager },
        row.etag,
        { listName }
      )
  );
}

/**
 * @param {ReassignForm} form
 * @param {string} groupName
 * @param {{ onReviewer: (reviewer: string) => void }} handlers
 * @returns {HTMLElement}
 */
function candidatesView(form, groupName, handlers) {
  if (form.candidatesError) {
    return h(
      'p',
      { className: 'cora-case-support-error', role: 'alert' },
      form.candidatesError
    );
  }
  if (!form.candidates) return LoadingState(`Loading ${groupName}`);
  if (form.candidates.length === 0) {
    return EmptyState(`Nobody else is in ${groupName}.`);
  }
  return h(
    'fieldset',
    { className: 'cora-case-support-candidates' },
    h('legend', {}, `New Assigned Reviewer, from ${groupName}`),
    ...form.candidates.map((person) =>
      h(
        'label',
        { className: 'cora-case-support-candidate' },
        h('input', {
          type: 'radio',
          name: 'cora-case-support-reviewer',
          value: person.loginName,
          checked: form.reviewer === person.loginName,
          disabled: form.saving,
          onchange: () => handlers.onReviewer(person.loginName),
        }),
        h('span', {}, person.displayName)
      )
    )
  );
}

/**
 * @param {ReassignForm} form
 * @param {string} groupName
 * @param {{
 *   onReviewer: (reviewer: string) => void,
 *   onReason: (reason: string) => void,
 *   onSubmit: () => void,
 *   onCancel: () => void,
 * }} handlers
 * @returns {HTMLElement}
 */
export function reassignFormView(form, groupName, handlers) {
  const ready = form.reviewer !== '' && form.reason.trim() !== '';
  return h(
    'section',
    {
      className: 'cora-case-support-form',
      'aria-labelledby': 'cora-case-support-form-title',
    },
    h('h2', { id: 'cora-case-support-form-title' }, 'Reassign the Reviewer'),
    h(
      'p',
      { className: 'cora-case-support-note' },
      'The assignment time and Reviewer Manager are restamped; the Due Date and status are unchanged.'
    ),
    candidatesView(form, groupName, handlers),
    reasonFieldView(form, handlers.onReason),
    ...formFooterView(
      form,
      { label: 'Reassign', savingLabel: 'Reassigning…', ready },
      handlers
    )
  );
}
