// @ts-check
/**
 * The pieces both Forms tables share: the Form, Employee and Status columns,
 * the Open or View button, and what a table shows while its read is pending
 * or has failed. Each tab adds its own columns between them.
 */

import { h } from '../../lib/html.js';
import { navigateTo } from '../../lib/navigate.js';
import { LoadingState } from '../../lib/empty-state.js';

/** @typedef {import('./forms-model.js').FormRow} FormRow */
/** @typedef {import('../../views/data-table.js').ColumnDescriptor<FormRow>} FormColumn */

/**
 * The badge class for each Form Status. Pending is the one open Status;
 * Completed reads as done; Void and Cancelled closed the Form without it.
 *
 * @type {Readonly<Record<string, string>>}
 */
const STATUS_BADGES = Object.freeze({
  Pending: 'cora-badge-open',
  Completed: 'cora-badge-complete',
  Void: 'cora-badge-muted',
  Cancelled: 'cora-badge-muted',
});

/** @returns {FormColumn} */
export const formTypeColumn = () => ({
  key: 'formType',
  label: 'Form',
  value: (row) => row.formType.formName,
  sortable: true,
  format: (value) => h('span', { className: 'cora-form-type' }, String(value)),
});

/** @returns {FormColumn} */
export const employeeColumn = () => ({
  key: 'employee',
  label: 'Employee',
  value: 'employeeName',
  sortable: true,
});

/**
 * A Form Status as its badge, wherever a Form's Status is shown.
 *
 * @param {string} status
 * @returns {HTMLElement}
 */
export function formStatusBadge(status) {
  return h(
    'span',
    { className: `cora-badge ${STATUS_BADGES[status] ?? ''}`.trim() },
    status
  );
}

/** @returns {FormColumn} */
export const formStatusColumn = () => ({
  key: 'status',
  label: 'Status',
  value: 'status',
  sortable: true,
  format: (value) => (value ? formStatusBadge(String(value)) : ''),
});

/**
 * Open for someone who may edit the Form, View for someone who may only read
 * it. `tellApart` adds what distinguishes two Forms of one type for one person
 * to the button's accessible name, since its visible text says only the verb.
 *
 * @param {(row: FormRow) => string} tellApart
 * @returns {FormColumn}
 */
export const formActionColumn = (tellApart) => ({
  key: 'action',
  label: 'Actions',
  value: (row) => row.access.canEdit,
  format: (canEdit, row) => {
    const verb = canEdit ? 'Open' : 'View';
    const detail = tellApart(row);
    return h(
      'button',
      {
        type: 'button',
        className: canEdit ? 'cora-case-open-btn' : 'cora-btn-secondary',
        'aria-label': `${verb} ${row.formType.formName} for ${row.employeeName}${detail ? `, ${detail}` : ''}`,
        onclick: () => navigateTo(row.href),
      },
      verb
    );
  },
});

/**
 * What a table shows instead of rows while its first read is pending or after
 * a read failed, or `null` once there are rows to show.
 *
 * @param {'idle' | 'loading' | 'loaded' | 'failed'} status
 * @returns {HTMLElement | null}
 */
export function readStateView(status) {
  if (status === 'idle' || status === 'loading') {
    return LoadingState('Loading forms');
  }
  if (status === 'failed') {
    return h(
      'p',
      { className: 'cora-form-error', role: 'alert' },
      'Forms could not be loaded. Try again shortly.'
    );
  }
  return null;
}

/**
 * The button that reads the next page, shown only while some Form Type has
 * one.
 *
 * @param {Record<string, string | null>} next
 * @param {() => void} onLoadMore
 * @returns {HTMLElement | null}
 */
export function loadMoreView(next, onLoadMore) {
  if (!Object.values(next).some((page) => page !== null)) return null;
  return h(
    'button',
    {
      type: 'button',
      className: 'cora-btn-secondary cora-form-load-more',
      onclick: onLoadMore,
    },
    'Load more'
  );
}
