// @ts-check
import { h } from '../lib/html.js';
import { caseRouteFor } from '../lib/case-route-links.js';

/**
 * The Case-shaped column descriptors every Case table is built from.
 *
 * `views/data-table.js` is the generic renderer and stays domain-free; this
 * module is its Case-aware *consumer*, which is why it lives beside the
 * renderer rather than inside it. These are framework descriptors and may hold
 * functions, because nothing outside framework code writes them: Case Types
 * contribute no columns, so a Case table cannot ship Case Type behaviour.
 *
 * Column `key`s are sort identity *and* CSS hooks (`cora-col-${key}`), so they
 * are part of the contract and never change.
 *
 * `sortable` lives on the shared descriptor rather than being decided per call
 * site, so the six tables showing Case-shaped data sort alike; a table that
 * wants a column unsortable has to say so.
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
 * than `undefined`.
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

/** @returns {CaseColumn} */
const caseResponsiblePartyColumn = () => ({
  key: 'responsibleParty',
  label: 'Responsible Party',
  value: 'responsibleParty',
  sortable: true,
});

/**
 * The Open button. `onOpen` is injected rather than baked as a navigation call
 * so the cell has no opinion about what opening a Case means: the Case tables
 * navigate, the Responsible Party's messages table opens a Conversation.
 *
 * Because the destination varies, so must the accessible name. The default,
 * `Open ${reference}`, suits every table that opens the Case; a table that opens
 * something else passes `openLabel`, or a screen-reader user hears the same name
 * from this button and from the row's Reference link while the two go to
 * different places.
 *
 * Deliberately not called `ariaLabel`: `ColumnDescriptor.ariaLabel` means
 * something else one file away — the generic renderer applies it to a cell's
 * `href` link, and this column has no `href`.
 *
 * @param {(row: CaseRow) => void} onOpen
 * @param {{ openLabel?: (value: unknown) => string }} [options]
 * @returns {CaseColumn}
 */
export const caseActionsColumn = (
  onOpen,
  { openLabel = (value) => `Open ${value}` } = {}
) => ({
  key: 'actions',
  label: 'Actions',
  value: (row) => row.title || row.id,
  format: (value, row) =>
    h(
      'button',
      {
        type: 'button',
        className: 'cora-case-open-btn',
        'aria-label': openLabel(value),
        onclick: () => onOpen(row),
      },
      'Open'
    ),
});

/**
 * The row class every Case-listing table passes as `rowClass`. Overdue is a
 * property of the Case — its SLA date has passed — not of the viewer's role, so
 * the rule is stated once here rather than repeated per page. The style hook is
 * `[data-cora-root] .cora-case-row--overdue td` in `styles/cora-styles.css`.
 *
 * `overdue` is the flag the SharePoint client derives on read (In-progress and
 * past `DueDate`); the Dashboard recomputes it locally for its own worklist.
 * Either way the class is the same, so the stylesheet has one hook.
 *
 * @param {CaseRow} row
 * @returns {string}
 */
export const overdueCaseRowClass = (row) =>
  row.overdue ? 'cora-case-row cora-case-row--overdue' : 'cora-case-row';

/**
 * The Case table shared by the Dashboard and Team Cases. The set is fixed: every
 * Case row carries these fields whichever list it came from, so a Case table
 * describes Cases the same way for every Case Type and scoping a table narrows
 * its rows, never its columns.
 *
 * A page that needs a column decides that here, in framework code, for every
 * Case Type at once. Nothing a Case Type declares reaches this list.
 *
 * @param {{ onOpen: (row: CaseRow) => void }} options
 * @returns {CaseColumn[]}
 */
export function standardCaseColumns({ onOpen }) {
  return [
    caseReferenceColumn(),
    caseTypeColumn(),
    caseRelatedDateColumn(),
    caseDueDateColumn(),
    caseStatusColumn(),
    caseAssignedColumn(),
    caseResponsiblePartyColumn(),
    caseActionsColumn(onOpen),
  ];
}
