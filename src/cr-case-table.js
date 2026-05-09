// @ts-check
import { CRElement } from './cr-element.js';
import { signal, computed } from './signal.js';

/** @typedef {import('./sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {'reference' | 'caseType' | 'relatedDate' | 'dueDate' | 'status' | 'assigned'} SortCol */

/** @type {Array<{ key: SortCol, label: string }>} */
const COLUMNS = [
  { key: 'reference', label: 'Reference' },
  { key: 'caseType', label: 'Case Type' },
  { key: 'relatedDate', label: 'Related Date' },
  { key: 'dueDate', label: 'Due Date' },
  { key: 'status', label: 'Status' },
  { key: 'assigned', label: 'Assigned' },
];

/**
 * @param {CaseRow} row
 * @param {SortCol} col
 * @returns {string}
 */
function cellValue(row, col) {
  switch (col) {
    case 'reference': return row.title || row.id;
    case 'caseType': return row.caseType;
    case 'relatedDate': return /** @type {any} */ (row).relatedDate || '';
    case 'dueDate': return row.dueDate || '';
    case 'status': return row.status;
    case 'assigned': return row.created || '';
    default: return '';
  }
}

export class CRCaseTable extends CRElement {
  constructor() {
    super();

    this._casesSignal = signal(/** @type {CaseRow[]} */ ([]));
    this._filterText = signal('');
    this._statusFilter = signal('');
    /** @type {{ get: () => SortCol | '' }} */
    this._sortCol = signal(/** @type {SortCol | ''} */ (''));
    this._sortDir = signal(/** @type {'asc' | 'desc'} */ ('asc'));

    this._rows = computed(() => {
      const cases = this._casesSignal.get();
      const text = this._filterText.get().toLowerCase();
      const status = this._statusFilter.get();
      const col = this._sortCol.get();
      const dir = this._sortDir.get();

      let rows = cases.filter(c => {
        if (status && c.status !== status) return false;
        if (!text) return true;
        return (
          (c.title || c.id).toLowerCase().includes(text) ||
          c.caseType.toLowerCase().includes(text) ||
          c.status.toLowerCase().includes(text)
        );
      });

      if (col) {
        rows = [...rows].sort((a, b) => {
          const va = cellValue(a, /** @type {SortCol} */ (col));
          const vb = cellValue(b, /** @type {SortCol} */ (col));
          const cmp = va < vb ? -1 : va > vb ? 1 : 0;
          return dir === 'asc' ? cmp : -cmp;
        });
      }

      return rows;
    });

    /** @type {Element | null} */
    this._tbodyEl = null;
    /** @type {Array<{ key: SortCol, th: Element }>} */
    this._headerCols = [];
  }

  /** @param {CaseRow[]} cases */
  set cases(cases) {
    this._casesSignal.set(cases);
  }

  connectedCallback() {
    this._buildLayout();
    this.subscribe(this._rows, rows => this._renderBody(rows));
    this.subscribe(this._sortCol, () => this._updateAriaSortHeaders());
    this.subscribe(this._sortDir, () => this._updateAriaSortHeaders());
  }

  _buildLayout() {
    // Toolbar
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
      statusSelect.appendChild(opt);
    }

    statusSelect.addEventListener('change', (/** @type {any} */ e) => {
      this._statusFilter.set(e.target?.value ?? '');
    });

    toolbar.replaceChildren(filterInput, statusSelect);

    // Table
    const table = document.createElement('table');
    table.className = 'cr-case-table';
    table.setAttribute('role', 'grid');
    table.addEventListener('keydown', (/** @type {any} */ e) => this._onTableKeydown(e));

    // thead
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    this._headerCols = [];
    for (const col of COLUMNS) {
      const th = document.createElement('th');
      th.setAttribute('scope', 'col');
      th.setAttribute('aria-sort', 'none');
      th.className = `cr-col-${col.key}`;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = col.label;
      btn.addEventListener('click', () => this._onHeaderClick(col.key));

      th.appendChild(btn);
      headRow.appendChild(th);
      this._headerCols.push({ key: col.key, th });
    }

    const thActions = document.createElement('th');
    thActions.setAttribute('scope', 'col');
    thActions.textContent = 'Actions';
    headRow.appendChild(thActions);

    thead.appendChild(headRow);

    const tbody = document.createElement('tbody');
    tbody.className = 'cr-case-table-body';
    this._tbodyEl = tbody;

    table.appendChild(thead);
    table.appendChild(tbody);

    this.replaceChildren(toolbar, table);
  }

  _updateAriaSortHeaders() {
    const col = this._sortCol.get();
    const dir = this._sortDir.get();
    for (const { key, th } of this._headerCols) {
      const ariaSort = key === col ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';
      th.setAttribute('aria-sort', ariaSort);
    }
  }

  /** @param {SortCol} col */
  _onHeaderClick(col) {
    const current = this._sortCol.get();
    if (current === col) {
      this._sortDir.set(this._sortDir.get() === 'asc' ? 'desc' : 'asc');
    } else {
      /** @type {any} */ (this._sortCol).set(col);
      this._sortDir.set('asc');
    }
  }

  /** @param {any} e */
  _onTableKeydown(e) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    if (!this._tbodyEl) return;

    const colCount = COLUMNS.length + 1; // +1 for actions column
    /** @type {Element[]} */
    const cells = [];
    const rows = /** @type {any[]} */ (/** @type {any} */ (this._tbodyEl)._children || []);
    for (const row of rows) {
      for (const cell of (/** @type {any} */ (row))._children || []) {
        cells.push(cell);
      }
    }

    const focused = /** @type {any} */ (globalThis)._lastFocused;
    const idx = cells.indexOf(focused);
    if (idx === -1) return;

    const rowIdx = Math.floor(idx / colCount);
    const colIdx = idx % colCount;
    let nextIdx = idx;

    if (e.key === 'ArrowRight' && colIdx < colCount - 1) nextIdx = idx + 1;
    else if (e.key === 'ArrowLeft' && colIdx > 0) nextIdx = idx - 1;
    else if (e.key === 'ArrowDown' && rowIdx < rows.length - 1) nextIdx = idx + colCount;
    else if (e.key === 'ArrowUp' && rowIdx > 0) nextIdx = idx - colCount;

    if (nextIdx !== idx && cells[nextIdx]) {
      e.preventDefault?.();
      /** @type {any} */ (cells[nextIdx]).focus?.();
    }
  }

  /** @param {CaseRow[]} rows */
  _renderBody(rows) {
    if (!this._tbodyEl) return;

    const rowEls = rows.map(c => {
      const tr = document.createElement('tr');
      tr.className = 'cr-case-row';
      tr.setAttribute('tabindex', '0');

      // Reference cell with link
      const tdRef = document.createElement('td');
      const link = document.createElement('a');
      link.href = `#/case/${c.id}`;
      link.textContent = c.title || c.id;
      tdRef.appendChild(link);

      const tdType = document.createElement('td');
      tdType.textContent = c.caseType;

      const tdRelated = document.createElement('td');
      tdRelated.textContent = /** @type {any} */ (c).relatedDate || '—';

      const tdDue = document.createElement('td');
      tdDue.textContent = c.dueDate || '—';

      const tdStatus = document.createElement('td');
      tdStatus.textContent = c.status;

      const tdAssigned = document.createElement('td');
      tdAssigned.textContent = c.created || '—';

      // Open button
      const tdActions = document.createElement('td');
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'cr-case-open-btn';
      openBtn.textContent = 'Open';
      openBtn.setAttribute('aria-label', `Open ${c.title || c.id}`);
      openBtn.addEventListener('click', () => this._openCase(c.id));
      tdActions.appendChild(openBtn);

      tr.addEventListener('keydown', (/** @type {any} */ e) => {
        if (e.key === 'Enter') this._openCase(c.id);
      });

      tr.replaceChildren(tdRef, tdType, tdRelated, tdDue, tdStatus, tdAssigned, tdActions);
      return tr;
    });

    /** @type {any} */ (this._tbodyEl).replaceChildren(...rowEls);
  }

  /** @param {string} caseId */
  _openCase(caseId) {
    this.dispatchEvent(new CustomEvent('cr-case-open', { detail: { caseId }, bubbles: true }));
  }
}

customElements.define('cr-case-table', CRCaseTable);
