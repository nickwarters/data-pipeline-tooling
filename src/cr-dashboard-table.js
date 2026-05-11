// @ts-check
import { CRElement } from './cr-element.js';
import { signal, computed } from './signal.js';

/**
 * @template Row
 * @typedef {{
 *   key: string,
 *   label: string,
 *   sortable?: boolean,
 *   getValue?: (row: Row) => string | number | null,
 *   renderCell?: (row: Row) => any,
 *   ariaLabel?: string,
 * }} ColumnDef
 */

export class CRDashboardTable extends CRElement {
  constructor() {
    super();

    /** @type {{ get: () => Array<ColumnDef<any>>, set: (v: Array<ColumnDef<any>>) => void }} */
    this._columns = signal(/** @type {Array<ColumnDef<any>>} */ ([]));
    /** @type {{ get: () => any[], set: (v: any[]) => void }} */
    this._rowsIn = signal(/** @type {any[]} */ ([]));
    this._sortKey = signal('');
    this._sortDir = signal(/** @type {'asc' | 'desc'} */ ('asc'));

    /** @type {(row: any) => string} */
    this._rowClass = () => '';
    /** @type {((row: any) => void) | null} */
    this._onRowActivate = null;

    this._sorted = computed(() => {
      const rows = this._rowsIn.get();
      const key = this._sortKey.get();
      const dir = this._sortDir.get();
      const cols = this._columns.get();
      if (!key) return rows;
      const col = cols.find(c => c.key === key);
      if (!col || !col.getValue) return rows;
      const get = col.getValue;
      const out = [...rows].sort((a, b) => {
        const va = get(a);
        const vb = get(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return dir === 'asc' ? cmp : -cmp;
      });
      return out;
    });

    this._mounted = false;
    /** @type {any} */
    this._tbodyEl = null;
    /** @type {Array<{ key: string, th: any }>} */
    this._headerCols = [];
  }

  /** @param {Array<ColumnDef<any>>} cols */
  set columns(cols) { this._columns.set(cols); }

  /** @param {any[]} rows */
  set rows(rows) { this._rowsIn.set(rows); }

  /** @param {(row: any) => string} fn */
  set rowClass(fn) { this._rowClass = fn || (() => ''); }

  /** @param {(row: any) => void} fn */
  set onRowActivate(fn) { this._onRowActivate = fn; }

  /** @param {{ key: string, dir?: 'asc' | 'desc' } | null} s */
  set sort(s) {
    if (!s) {
      this._sortKey.set('');
      return;
    }
    this._sortKey.set(s.key);
    this._sortDir.set(s.dir === 'desc' ? 'desc' : 'asc');
  }

  connectedCallback() {
    if (this._mounted) return;
    this._mounted = true;
    this._buildLayout();
    this.subscribe(this._sorted, rows => this._renderBody(rows));
    this.subscribe(this._sortKey, () => this._updateAriaSort());
    this.subscribe(this._sortDir, () => this._updateAriaSort());
  }

  _buildLayout() {
    const table = document.createElement('table');
    table.className = 'cr-dashboard-table';
    table.setAttribute('role', 'grid');
    table.addEventListener('keydown', (/** @type {any} */ e) => this._onKeydown(e));

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    this._headerCols = [];
    for (const col of this._columns.get()) {
      const th = document.createElement('th');
      th.setAttribute('scope', 'col');
      th.setAttribute('aria-sort', 'none');
      th.className = `cr-col-${col.key}`;
      if (col.sortable) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = col.label;
        btn.addEventListener('click', () => this._onHeaderClick(col.key));
        th.appendChild(btn);
      } else {
        th.textContent = col.label;
      }
      headRow.appendChild(th);
      this._headerCols.push({ key: col.key, th });
    }
    thead.appendChild(/** @type {any} */ (headRow));

    const tbody = document.createElement('tbody');
    tbody.className = 'cr-dashboard-table-body';
    this._tbodyEl = tbody;

    table.appendChild(/** @type {any} */ (thead));
    table.appendChild(/** @type {any} */ (tbody));

    this.replaceChildren(/** @type {any} */ (table));
  }

  /** @param {any[]} rows */
  _renderBody(rows) {
    if (!this._tbodyEl) return;
    const cols = this._columns.get();
    const trs = rows.map(row => {
      const tr = document.createElement('tr');
      const cls = this._rowClass(row);
      if (cls) tr.className = cls;
      tr.setAttribute('tabindex', '0');
      if (this._onRowActivate) {
        const activate = this._onRowActivate;
        tr.addEventListener('keydown', (/** @type {any} */ e) => {
          if (e.key === 'Enter') activate(row);
        });
      }
      for (const col of cols) {
        const td = document.createElement('td');
        if (col.renderCell) {
          const content = col.renderCell(row);
          if (typeof content === 'string') {
            td.textContent = content;
          } else if (content != null) {
            td.appendChild(content);
          }
        } else if (col.getValue) {
          const v = col.getValue(row);
          td.textContent = v == null || v === '' ? '—' : String(v);
        }
        tr.appendChild(/** @type {any} */ (td));
      }
      return tr;
    });
    /** @type {any} */ (this._tbodyEl).replaceChildren(...trs);
  }

  _updateAriaSort() {
    const key = this._sortKey.get();
    const dir = this._sortDir.get();
    for (const { key: k, th } of this._headerCols) {
      const v = k === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';
      th.setAttribute('aria-sort', v);
    }
  }

  /** @param {string} key */
  _onHeaderClick(key) {
    if (this._sortKey.get() === key) {
      this._sortDir.set(this._sortDir.get() === 'asc' ? 'desc' : 'asc');
    } else {
      this._sortKey.set(key);
      this._sortDir.set('asc');
    }
  }

  /** @param {any} e */
  _onKeydown(e) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    if (!this._tbodyEl) return;
    const colCount = this._columns.get().length;
    if (colCount === 0) return;

    /** @type {any[]} */
    const cells = [];
    const rows = /** @type {any[]} */ (/** @type {any} */ (this._tbodyEl)._children || []);
    for (const row of rows) {
      for (const cell of (/** @type {any} */ (row))._children || []) cells.push(cell);
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
}

customElements.define('cr-dashboard-table', CRDashboardTable);
