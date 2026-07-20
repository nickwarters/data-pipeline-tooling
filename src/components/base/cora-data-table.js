// @ts-check
import { h } from '../../lib/html.js';

/**
 * @template Row
 * @typedef {{
 * key: string,
 * label: string,
 * sortable?: boolean,
 * getValue?: (row: Row) => string | number | null,
 * renderCell?: (row: Row) => any,
 * ariaLabel?: string,
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
      class: 'cora-data-table',
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
            class: `cora-col-${col.key}`,
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
      { class: 'cora-data-table-body' },
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
