// @ts-check
import { CRElement } from './cr-element.js';
import { signal, computed } from '../lib/signal.js';
import { CRDashboardTable } from './cr-dashboard-table.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('./cr-dashboard-table.js').ColumnDef<CaseRow>} CaseColumn */

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
      getValue: r => r.title || r.id,
      renderCell: r => {
        const a = document.createElement('a');
        a.href = `#/case/${r.id}`;
        a.textContent = r.title || r.id;
        return a;
      },
    },
    {
      key: 'caseType',
      label: 'Case Type',
      sortable: true,
      getValue: r => r.caseType,
    },
    {
      key: 'relatedDate',
      label: 'Related Date',
      sortable: true,
      getValue: r => /** @type {any} */ (r).relatedDate || '',
    },
    {
      key: 'dueDate',
      label: 'Due Date',
      sortable: true,
      getValue: r => r.dueDate || '',
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      getValue: r => r.status,
    },
    {
      key: 'assigned',
      label: 'Assigned',
      sortable: true,
      getValue: r => r.created || '',
    },
    {
      key: 'actions',
      label: 'Actions',
      renderCell: r => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cr-case-open-btn';
        btn.textContent = 'Open';
        btn.setAttribute('aria-label', `Open ${r.title || r.id}`);
        btn.addEventListener('click', () => openCase(r.id));
        return btn;
      },
    },
  ];
}

export class CRCaseTable extends CRElement {
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
      return cases.filter(c => {
        if (status && c.status !== status) return false;
        if (!text) return true;
        return (
          (c.title || c.id).toLowerCase().includes(text) ||
          c.caseType.toLowerCase().includes(text) ||
          c.status.toLowerCase().includes(text)
        );
      });
    });

    this._mounted = false;
    /** @type {CRDashboardTable | null} */
    this._inner = null;
  }

  /** @param {CaseRow[]} cases */
  set cases(cases) { this._casesSignal.set(cases); }
  get cases() { return this._casesSignal.get(); }

  /** @param {CaseColumn[]} cols */
  set columns(cols) { this._customColumns = cols; }

  /** @param {(row: CaseRow) => string} fn */
  set rowClass(fn) { this._customRowClass = fn; }

  /** @param {'default' | 'hidden'} mode */
  set toolbar(mode) { this._toolbarMode = mode; }

  /** @param {{ key: string, dir?: 'asc' | 'desc' } | null} s */
  set sort(s) { this._initialSort = s; }

  connectedCallback() {
    if (this._mounted) return;
    this._mounted = true;

    /** @type {any[]} */
    const children = [];
    if (this._toolbarMode === 'default' && !this._customColumns) {
      children.push(this._buildToolbar());
    }

    const inner = new CRDashboardTable();
    this._inner = inner;
    const columns = this._customColumns ?? defaultColumns(id => this._openCase(id));
    inner.columns = columns;
    if (this._customRowClass) {
      inner.rowClass = this._customRowClass;
    } else if (!this._customColumns) {
      inner.rowClass = () => 'cr-case-row';
    }
    inner.onRowActivate = (/** @type {CaseRow} */ row) => this._openCase(row.id);
    if (this._initialSort) inner.sort = this._initialSort;

    children.push(inner);
    this.replaceChildren(...children);
    inner.connectedCallback();

    this.subscribe(this._filtered, rows => {
      if (this._inner) this._inner.rows = rows;
    });
  }

  _buildToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'cr-case-table-toolbar';

    const filterInput = document.createElement('input');
    filterInput.className = 'cr-case-table-filter';
    filterInput.type = 'text';
    filterInput.setAttribute('placeholder', 'Filter cases…');
    filterInput.setAttribute('aria-label', 'Filter cases');
    filterInput.addEventListener('input', (/** @type {any} */ e) => {
      this._filterText.set(e.target?.value ?? '');
    });

    const statusSelect = document.createElement('select');
    statusSelect.className = 'cr-case-table-status-filter';
    statusSelect.setAttribute('aria-label', 'Filter by status');
    for (const [val, label] of [['', 'All statuses'], ['In-progress', 'In Progress'], ['Completed', 'Completed']]) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      statusSelect.appendChild(/** @type {any} */ (opt));
    }
    statusSelect.addEventListener('change', (/** @type {any} */ e) => {
      this._statusFilter.set(e.target?.value ?? '');
    });

    toolbar.replaceChildren(/** @type {any} */ (filterInput), /** @type {any} */ (statusSelect));
    return toolbar;
  }

  /** @param {string} caseId */
  _openCase(caseId) {
    this.dispatchEvent(new CustomEvent('cr-case-open', { detail: { caseId }, bubbles: true }));
  }
}

customElements.define('cr-case-table', CRCaseTable);
