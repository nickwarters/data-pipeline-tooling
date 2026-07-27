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
 *
 * **Reference and Case Type sort on every Case table (#542).** They did not
 * used to: the Dashboard reviewer worklist, Team Cases and Journey Cases sorted
 * them, while Controls' Appeals table and both Responsible Party tables
 * rendered the same two columns as inert text. The six tables show the same
 * Case-shaped data, so someone who learns to sort by Reference on the Dashboard
 * should not find the same column dead on Controls. Nothing was lost by
 * converging — the three tables that gained sort gained a capability — so
 * `sortable` lives on the shared descriptor rather than being decided per call
 * site. A table that wants a column unsortable now has to say so, which is the
 * right way round for a divergence that was never intended.
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
 * Because the destination varies, so must the accessible name. The default,
 * `Open ${reference}`, is right for every table that opens the Case; a table
 * that opens something else passes `openLabel` and says so, or a screen-reader
 * user hears the same name from this button and from the row's Reference link
 * while the two go to different places (#541).
 *
 * Deliberately not called `ariaLabel`: `ColumnDescriptor.ariaLabel` already
 * means something else one file away — the generic renderer applies it to a
 * cell's `href` link, taking the row, and this column has no `href`. Same name
 * for a different argument on a different element is the kind of collision a
 * comment stops being able to hold apart.
 *
 * @param {(row: CaseRow) => void} onOpen
 * @param {{ openLabel?: (value: unknown) => string }} [options] Named because
 *   it is the optional half — the three Case tables keep calling with `onOpen`
 *   alone, exactly as before.
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
 * The row class every Case-listing table passes as `rowClass`.
 *
 * **Overdue styling belongs on every Case table (#542).** The Dashboard
 * reviewer worklist and Team Cases have always emitted this modifier; Journey
 * Cases emitted no row class at all. Overdue is a property of the *Case* — its
 * SLA date has passed — not of the viewer's role, and a Journey Owner looking
 * at a Case that has breached its SLA is exactly who needs to see it.
 * Suppressing it on one table of six reads as an omission, not a decision, so
 * the rule is stated once here rather than repeated per page.
 *
 * Worth knowing, because the comment that used to sit here said otherwise:
 * before #542 the `cora-case-row--overdue` class had *no stylesheet rule*, so
 * the Dashboard and Team Cases emitted it and rendered an overdue Case exactly
 * like any other. Converging Journey Cases onto a class that styled nothing
 * would have been an empty decision, so #542 also added the rule —
 * `[data-cora-root] .cora-case-row--overdue td` in `styles/cora-styles.css`,
 * grouped with the `.cora-overdue` selectors the Responsible Party remediation
 * table already used, so all four Case-shaped tables show a breach the same way.
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
