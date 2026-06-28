// @ts-check
import { ShellElement } from '../lib/view.js';
import { signal, computed } from '../lib/signal.js';
import { h } from '../lib/html.js';

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

/**
 * @typedef {Object} DataTableProps
 * @property {Array<ColumnDef<any>>} columns
 * @property {any[]} rows
 * @property {string} sortKey
 * @property {'asc' | 'desc'} sortDir
 * @property {(row: any) => string} rowClass
 * @property {((row: any) => void) | null} onRowActivate
 * @property {(key: string) => void} onHeaderClick
 * @property {(event: KeyboardEvent) => void} onKeydown
 * @property {(tbody: HTMLElement) => void} onTbody
 */

/**
 * @param {DataTableProps} props
 * @returns {HTMLElement}
 */
export function DataTable({
  columns,
  rows,
  sortKey,
  sortDir,
  rowClass,
  onRowActivate,
  onHeaderClick,
  onKeydown,
  onTbody,
}) {
  let tbody;

  const table = h(
    'table',
    {
      class: 'cr-data-table',
      role: 'grid',
      onkeydown: onKeydown,
    },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        ...columns.map((col) => {
          const v =
            col.key === sortKey
              ? sortDir === 'asc'
                ? 'ascending'
                : 'descending'
              : 'none';
          const thProps = {
            scope: 'col',
            'aria-sort': v,
            class: `cr-col-${col.key}`,
          };

          if (col.sortable) {
            return h(
              'th',
              thProps,
              h(
                'button',
                {
                  type: 'button',
                  onclick: () => onHeaderClick(col.key),
                },
                col.label
              )
            );
          }
          return h('th', thProps, col.label);
        })
      )
    ),
    (tbody = h(
      'tbody',
      { class: 'cr-data-table-body' },
      ...rows.map((row) => {
        const cls = rowClass(row);
        /** @type {any} */
        const trProps = { tabindex: '0' };
        if (cls) trProps.class = cls;
        if (onRowActivate) {
          trProps.onkeydown = (/** @type {any} */ e) => {
            if (e.key === 'Enter') onRowActivate(row);
          };
        }

        return h(
          'tr',
          trProps,
          ...columns.map((col) => {
            let content;
            if (col.renderCell) {
              const rc = col.renderCell(row);
              content = rc == null ? [] : rc;
            } else if (col.getValue) {
              const v = col.getValue(row);
              content = v == null || v === '' ? '—' : String(v);
            } else {
              content = '—';
            }
            return h('td', {}, content);
          })
        );
      })
    ))
  );

  onTbody(tbody);
  return table;
}

export class CRDataTable extends ShellElement {
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
      const col = cols.find((c) => c.key === key);
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
  }

  /** @param {Array<ColumnDef<any>>} cols */
  set columns(cols) {
    this._columns.set(cols);
  }

  /** @param {any[]} rows */
  set rows(rows) {
    this._rowsIn.set(rows);
  }

  /** @param {(row: any) => string} fn */
  set rowClass(fn) {
    this._rowClass = fn || (() => '');
  }

  /** @param {(row: any) => void} fn */
  set onRowActivate(fn) {
    this._onRowActivate = fn;
  }

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
    super.connectedCallback();
  }

  render() {
    return DataTable({
      columns: this._columns.get(),
      rows: this._sorted.get(),
      sortKey: this._sortKey.get(),
      sortDir: this._sortDir.get(),
      rowClass: this._rowClass,
      onRowActivate: this._onRowActivate,
      onHeaderClick: (key) => this._onHeaderClick(key),
      onKeydown: (/** @type {any} */ e) => this._onKeydown(e),
      onTbody: (tbody) => {
        this._tbodyEl = tbody;
      },
    });
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
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key))
      return;
    if (!this._tbodyEl) return;
    const colCount = this._columns.get().length;
    if (colCount === 0) return;

    /** @type {any[]} */
    const cells = [];
    const rows = /** @type {any[]} */ (
      /** @type {any} */ (this._tbodyEl)._children || []
    );
    for (const row of rows) {
      for (const cell of /** @type {any} */ (row)._children || [])
        cells.push(cell);
    }

    const focused = /** @type {any} */ (globalThis)._lastFocused;
    const idx = cells.indexOf(focused);
    if (idx === -1) return;

    const rowIdx = Math.floor(idx / colCount);
    const colIdx = idx % colCount;
    let nextIdx = idx;

    if (e.key === 'ArrowRight' && colIdx < colCount - 1) nextIdx = idx + 1;
    else if (e.key === 'ArrowLeft' && colIdx > 0) nextIdx = idx - 1;
    else if (e.key === 'ArrowDown' && rowIdx < rows.length - 1)
      nextIdx = idx + colCount;
    else if (e.key === 'ArrowUp' && rowIdx > 0) nextIdx = idx - colCount;

    if (nextIdx !== idx && cells[nextIdx]) {
      e.preventDefault?.();
      /** @type {any} */ (cells[nextIdx]).focus?.();
    }
  }
}

customElements.define('cr-data-table', CRDataTable);
