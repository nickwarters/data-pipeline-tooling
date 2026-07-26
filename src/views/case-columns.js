// @ts-check
import { h } from '../lib/html.js';
import { caseRouteFor } from '../lib/case-route-links.js';

/**
 * The Case-shaped column descriptors every Case table is built from.
 *
 * `views/data-table.js` is the generic renderer and stays domain-free
 * (ADR-0035); this module is its Case-aware *consumer*, which is why it lives
 * beside the renderer rather than inside it. These are framework descriptors
 * and may hold functions — unlike `CaseTableColumnDescriptor` in
 * `sharepoint-client.js`, the deliberately data-only shape a Case Type may
 * contribute. The two are distinct on purpose: merging them would let a Case
 * Type ship behaviour.
 *
 * Column `key`s are sort identity *and* CSS hooks (`cora-col-${key}`), so they
 * are part of the contract and never change.
 */

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('./data-table.js').ColumnDescriptor<CaseRow>} CaseColumn */

/** @returns {CaseColumn} */
export const caseReferenceColumn = () => ({
  key: 'reference',
  label: 'Reference',
  value: (row) => row.title || row.id,
  sortable: true,
  href: caseRouteFor,
});

/** @returns {CaseColumn} */
export const caseTypeColumn = () => ({
  key: 'caseType',
  label: 'Case Type',
  value: 'caseType',
  sortable: true,
});

/** @returns {CaseColumn} */
export const caseStatusColumn = () => ({
  key: 'status',
  label: 'Status',
  value: 'status',
  sortable: true,
});

/**
 * The Case's own date fields sort as strings, so a missing one is `''` rather
 * than `undefined` — that keeps the legacy ordering the tables shipped with.
 *
 * @returns {CaseColumn}
 */
const caseRelatedDateColumn = () => ({
  key: 'relatedDate',
  label: 'Related Date',
  value: (row) => /** @type {any} */ (row).relatedDate || '',
  sortable: true,
});

/** @returns {CaseColumn} */
const caseDueDateColumn = () => ({
  key: 'dueDate',
  label: 'Due Date',
  value: (row) => row.dueDate || '',
  sortable: true,
});

/** @returns {CaseColumn} */
const caseAssignedColumn = () => ({
  key: 'assigned',
  label: 'Assigned',
  value: (row) => row.created || '',
  sortable: true,
});

/**
 * The Open button. `onOpen` is injected rather than baked as a navigation
 * call so the cell has no opinion about what opening a Case means: the Case
 * tables navigate, the Responsible Party's messages table opens a
 * Conversation.
 *
 * @param {(row: CaseRow) => void} onOpen
 * @returns {CaseColumn}
 */
export const caseActionsColumn = (onOpen) => ({
  key: 'actions',
  label: 'Actions',
  value: (row) => row.title || row.id,
  format: (value, row) =>
    h(
      'button',
      {
        type: 'button',
        className: 'cora-case-open-btn',
        'aria-label': `Open ${value}`,
        onclick: () => onOpen(row),
      },
      'Open'
    ),
});

/**
 * The seven-column Case table shared by the Dashboard and Team Cases. `extra`
 * is where a Case Type's own `caseTableColumns` append.
 *
 * @param {{ onOpen: (row: CaseRow) => void, extra?: CaseColumn[] }} options
 * @returns {CaseColumn[]}
 */
export function standardCaseColumns({ onOpen, extra = [] }) {
  return [
    caseReferenceColumn(),
    caseTypeColumn(),
    caseRelatedDateColumn(),
    caseDueDateColumn(),
    caseStatusColumn(),
    caseAssignedColumn(),
    caseActionsColumn(onOpen),
    ...extra,
  ];
}
