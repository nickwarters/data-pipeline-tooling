// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { signal, computed } from '../lib/signal.js';
import { h } from '../lib/html.js';
import { CRDataTable } from './cr-data-table.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('./cr-data-table.js').ColumnDef<CaseRow>} CaseColumn */

/**
 * Default column set: Reference (link), Case Type, Related Date, Due Date,
 * Status, Assigned, and an Actions column with an Open button that dispatches
 * `cr-case-open`. Behaviour matches the pre-refactor table when no custom
 * `columns` prop is supplied.
 *
 * @param {(caseId: string) => void} openCase
 * @returns {CaseColumn[]}
 */
function defaultColumns(openCase) {
  return [
    {
      key: 'reference',
      label: 'Reference',
      sortable: true,
      getValue: (r) => r.title || r.id,
      renderCell: (r) => h('a', { href: `#/case/${r.id}` }, r.title || r.id),
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
            onclick: () => openCase(r.id),
          },
          'Open'
        ),
    },
  ];
}

export class CRCaseTable extends ReactiveElement {
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
  }

  render() {
    if (!this._toolbar) {
      this._toolbar = this._buildToolbar();
    }

    if (!this._inner) {
      this._inner = new CRDataTable();
    }

    const columns =
      this._customColumns ?? defaultColumns((id) => this._openCase(id));
    this._inner.columns = columns;

    if (this._customRowClass) {
      this._inner.rowClass = this._customRowClass;
    } else if (!this._customColumns) {
      this._inner.rowClass = (/** @type {CaseRow} */ row) =>
        row.overdue ? 'cr-case-row cr-case-row--overdue' : 'cr-case-row';
    }

    this._inner.onRowActivate = (/** @type {CaseRow} */ row) =>
      this._openCase(row.id);
    if (this._initialSort) this._inner.sort = this._initialSort;

    this._inner.rows = this._filtered.get();

    const children = [];
    if (this._toolbarMode === 'default' && !this._customColumns) {
      children.push(this._toolbar);
    }
    children.push(this._inner);

    return children;
  }

  _buildToolbar() {
    return h(
      'div',
      { className: 'cr-case-table-toolbar' },
      h('input', {
        className: 'cr-case-table-filter',
        type: 'text',
        placeholder: 'Filter cases…',
        'aria-label': 'Filter cases',
        oninput: (/** @type {any} */ e) =>
          this._filterText.set(e.target?.value ?? ''),
      }),
      h(
        'select',
        {
          className: 'cr-case-table-status-filter',
          'aria-label': 'Filter by status',
          onchange: (/** @type {any} */ e) =>
            this._statusFilter.set(e.target?.value ?? ''),
        },
        h('option', { value: '' }, 'All statuses'),
        h('option', { value: 'In-progress' }, 'In Progress'),
        h('option', { value: 'Completed' }, 'Completed')
      )
    );
  }

  /** @param {string} caseId */
  _openCase(caseId) {
    this.dispatchEvent(
      new CustomEvent('cr-case-open', { detail: { caseId }, bubbles: true })
    );
  }
}

customElements.define('cr-case-table', CRCaseTable);
