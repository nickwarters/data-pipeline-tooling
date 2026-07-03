// @ts-check
import { ShellElement } from '../lib/view.js';
import { signal, computed, effect } from '../lib/signal.js';
import { h } from '../lib/html.js';
import { CRDataTable } from './cr-data-table.js';
import { caseRouteFor } from '../lib/case-route-links.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('./cr-data-table.js').ColumnDef<CaseRow>} CaseColumn */

/**
 * Default column set: Reference (link), Case Type, Related Date, Due Date,
 * Status, Assigned, and an Actions column with an Open button that dispatches
 * `cr-case-open`. Behaviour matches the pre-refactor table when no custom
 * `columns` prop is supplied.
 *
 * @param {(row: CaseRow) => void} openCase
 * @returns {CaseColumn[]}
 */
export function defaultCaseColumns(openCase) {
  return [
    {
      key: 'reference',
      label: 'Reference',
      sortable: true,
      getValue: (r) => r.title || r.id,
      renderCell: (r) => h('a', { href: caseRouteFor(r) }, r.title || r.id),
    },
    {
      key: 'caseType',
      label: 'Case Type',
      sortable: true,
      getValue: (r) => r.caseType,
    },
    {
      key: 'relatedDate',
      label: 'Related Date',
      sortable: true,
      getValue: (r) => /** @type {any} */ (r).relatedDate || '',
    },
    {
      key: 'dueDate',
      label: 'Due Date',
      sortable: true,
      getValue: (r) => r.dueDate || '',
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      getValue: (r) => r.status,
    },
    {
      key: 'assigned',
      label: 'Assigned',
      sortable: true,
      getValue: (r) => r.created || '',
    },
    {
      key: 'actions',
      label: 'Actions',
      renderCell: (r) =>
        h(
          'button',
          {
            type: 'button',
            className: 'cr-case-open-btn',
            'aria-label': `Open ${r.title || r.id}`,
            onclick: () => openCase(r),
          },
          'Open'
        ),
    },
  ];
}

/**
 * @typedef {Object} CaseTableToolbarProps
 * @property {(text: string) => void} onFilterText
 * @property {(status: string) => void} onStatusFilter
 */

/**
 * @param {CaseTableToolbarProps} props
 * @returns {HTMLElement}
 */
export function CaseTableToolbar({ onFilterText, onStatusFilter }) {
  return h(
    'div',
    { className: 'cr-case-table-toolbar' },
    h('input', {
      className: 'cr-case-table-filter',
      type: 'text',
      placeholder: 'Filter cases…',
      'aria-label': 'Filter cases',
      oninput: (/** @type {any} */ e) => onFilterText(e.target?.value ?? ''),
    }),
    h(
      'select',
      {
        className: 'cr-case-table-status-filter',
        'aria-label': 'Filter by status',
        onchange: (/** @type {any} */ e) =>
          onStatusFilter(e.target?.value ?? ''),
      },
      h('option', { value: '' }, 'All statuses'),
      h('option', { value: 'In-progress' }, 'In Progress'),
      h('option', { value: 'Completed' }, 'Completed')
    )
  );
}

/**
 * @typedef {Object} CaseTableProps
 * @property {CaseRow[]} rows
 * @property {CaseColumn[] | null} customColumns
 * @property {((row: CaseRow) => string) | null} customRowClass
 * @property {'default' | 'hidden'} toolbarMode
 * @property {{ key: string, dir?: 'asc' | 'desc' } | null} initialSort
 * @property {HTMLElement | null} toolbar
 * @property {CRDataTable | null} inner
 * @property {(toolbar: HTMLElement) => void} onToolbar
 * @property {(inner: CRDataTable) => void} onInner
 * @property {(row: CaseRow) => void} onOpenCase
 * @property {(text: string) => void} onFilterText
 * @property {(status: string) => void} onStatusFilter
 */

/**
 * @param {CaseTableProps} props
 * @returns {Array<HTMLElement | CRDataTable>}
 */
export function CaseTable({
  rows,
  customColumns,
  customRowClass,
  toolbarMode,
  initialSort,
  toolbar,
  inner,
  onToolbar,
  onInner,
  onOpenCase,
  onFilterText,
  onStatusFilter,
}) {
  const toolbarEl =
    toolbar ?? CaseTableToolbar({ onFilterText, onStatusFilter });
  if (!toolbar) onToolbar(toolbarEl);

  const innerTable = inner ?? new CRDataTable();
  if (!inner) onInner(innerTable);

  const columns = customColumns ?? defaultCaseColumns(onOpenCase);
  innerTable.columns = columns;

  if (customRowClass) {
    innerTable.rowClass = customRowClass;
  } else if (!customColumns) {
    innerTable.rowClass = (/** @type {CaseRow} */ row) =>
      row.overdue ? 'cr-case-row cr-case-row--overdue' : 'cr-case-row';
  }

  innerTable.onRowActivate = (/** @type {CaseRow} */ row) => onOpenCase(row);
  if (initialSort) innerTable.sort = initialSort;
  innerTable.rows = rows;

  const children = [];
  if (toolbarMode === 'default' && !customColumns) {
    children.push(toolbarEl);
  }
  children.push(innerTable);
  return children;
}

export class CRCaseTable extends ShellElement {
  constructor() {
    super();

    this._casesSignal = signal(/** @type {CaseRow[]} */ ([]));
    this._filterText = signal('');
    this._statusFilter = signal('');

    /** @type {CaseColumn[] | null} */
    this._customColumns = null;
    /** @type {((row: CaseRow) => string) | null} */
    this._customRowClass = null;
    /** @type {'default' | 'hidden'} */
    this._toolbarMode = 'default';
    /** @type {{ key: string, dir?: 'asc' | 'desc' } | null} */
    this._initialSort = null;

    this._filtered = computed(() => {
      const cases = this._casesSignal.get();
      // Custom-column callers filter externally; skip built-in text/status filter.
      if (this._customColumns) return cases;
      const text = this._filterText.get().toLowerCase();
      const status = this._statusFilter.get();
      return cases.filter((c) => {
        if (status && c.status !== status) return false;
        if (!text) return true;
        return (
          (c.title || c.id).toLowerCase().includes(text) ||
          c.caseType.toLowerCase().includes(text) ||
          c.status.toLowerCase().includes(text)
        );
      });
    });

    /** @type {CRDataTable | null} */
    this._inner = null;
    /** @type {HTMLElement | null} */
    this._toolbar = null;
    /** @type {(() => void) | null} */
    this._rowsFeed = null;
  }

  /** @param {CaseRow[]} cases */
  set cases(cases) {
    this._casesSignal.set(cases);
  }
  get cases() {
    return this._casesSignal.get();
  }

  /** @param {CaseColumn[]} cols */
  set columns(cols) {
    this._customColumns = cols;
  }

  /** @param {(row: CaseRow) => string} fn */
  set rowClass(fn) {
    this._customRowClass = fn;
  }

  /** @param {'default' | 'hidden'} mode */
  set toolbar(mode) {
    this._toolbarMode = mode;
  }

  /** @param {{ key: string, dir?: 'asc' | 'desc' } | null} s */
  set sort(s) {
    this._initialSort = s;
  }

  connectedCallback() {
    super.connectedCallback();
    if (this._inner) {
      this._inner.connectedCallback();
    }
    // Feed the filtered/sorted rows into the inner table through a dedicated
    // effect rather than by reading `_filtered` inside render(). If render()
    // depended on the filter signals, every keystroke would re-run the shell's
    // render effect, which replaces the host's children — re-inserting the inner
    // <cr-data-table>. In a real browser that fires disconnected/connected on
    // the inner element (its reconnect is a no-op guarded by `_mounted`), which
    // silently kills the inner table's reactivity AND blurs the filter input on
    // every keystroke. Keeping the structure static and pushing only rows into
    // the already-mounted inner table avoids both.
    if (!this._rowsFeed) {
      this._rowsFeed = effect(() => {
        const rows = this._filtered.get();
        if (this._inner) this._inner.rows = rows;
      });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._rowsFeed) {
      this._rowsFeed();
      this._rowsFeed = null;
    }
  }

  render() {
    if (!this._toolbar) {
      this._toolbar = this._buildToolbar();
    }

    if (!this._inner) {
      this._inner = new CRDataTable();
    }

    return CaseTable({
      // Rows are pushed into the inner table by the _rowsFeed effect set up in
      // connectedCallback; render() intentionally does not read `_filtered` so
      // the shell renders its structure once and never tears it down on filter
      // changes. The inner table starts empty and is populated by that effect.
      rows: [],
      customColumns: this._customColumns,
      customRowClass: this._customRowClass,
      toolbarMode: this._toolbarMode,
      initialSort: this._initialSort,
      toolbar: this._toolbar,
      inner: this._inner,
      onToolbar: (toolbar) => {
        this._toolbar = toolbar;
      },
      onInner: (inner) => {
        this._inner = inner;
      },
      onOpenCase: (row) => this._openCase(row),
      onFilterText: (text) => this._filterText.set(text),
      onStatusFilter: (status) => this._statusFilter.set(status),
    });
  }

  _buildToolbar() {
    return CaseTableToolbar({
      onFilterText: (text) => this._filterText.set(text),
      onStatusFilter: (status) => this._statusFilter.set(status),
    });
  }

  /** @param {CaseRow} row */
  _openCase(row) {
    this.dispatchEvent(
      new CustomEvent('cr-case-open', {
        detail: { caseId: row.id, caseRow: row },
        bubbles: true,
      })
    );
  }
}

customElements.define('cr-case-table', CRCaseTable);
