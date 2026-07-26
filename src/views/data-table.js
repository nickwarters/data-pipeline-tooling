// @ts-check
import { h } from '../lib/html.js';
import { navigateTo } from '../lib/navigate.js';

/**
 * Declarative variation supported by the generic data-table view. A column
 * resolves its raw value either from a dot-separated property path or from a
 * derivation function. Formatting and link creation remain functions when the
 * behaviour cannot be expressed as data; descriptors should not contain
 * branching mini-renderers.
 *
 * @template Row
 * @typedef {Object} ColumnDescriptor
 * @property {string} key Stable identity used by sorting and CSS hooks.
 * @property {string} label Visible column heading.
 * @property {string | ((row: Row) => unknown)} value Property path or pure value derivation.
 * @property {boolean} [sortable] Whether the heading requests sorting.
 * @property {(value: unknown, row: Row) => Node | string | number | null} [format] Optional display formatting.
 * @property {(row: Row) => string} [href] Optional cell link destination.
 * @property {string | ((row: Row) => string)} [ariaLabel] Optional link label.
 */

/**
 * @typedef {{ key: string, dir: 'asc' | 'desc' }} TableSort
 */

/**
 * @template Row
 * @typedef {Object} DataTableViewProps
 * @property {Row[]} rows
 * @property {Row[]} [footerRows] Rows rendered after, and excluded from, the sortable body.
 * @property {ColumnDescriptor<Row>[]} columns
 * @property {TableSort | null} sort
 * @property {(key: string) => void} onSort
 * @property {string} emptyMessage
 * @property {(row: Row) => string} rowKey
 * @property {(row: Row) => string} [rowHref]
 * @property {(hash: string) => void} [onNavigate] How row activation changes
 *   route. Defaults to the `lib/navigate.js` seam so no call site has to pass
 *   it; injectable so this generic renderer never has to reach for a global.
 * @property {(row: Row) => string} [rowClass]
 */

/**
 * @param {TableSort | null} current
 * @param {string} key
 * @returns {TableSort}
 */
export function nextTableSort(current, key) {
  if (current?.key !== key) return { key, dir: 'asc' };
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

/**
 * The action a sortable table's `onSort` dispatches. Every table names its
 * action after itself — `${table}-table/sort-requested` — because a page with
 * two tables (the Dashboard) cannot share one `table/` namespace.
 *
 * @param {string} table - the table's name, e.g. 'reviewer'
 * @param {string} key - the column key that was clicked
 * @returns {{ type: string, key: string }}
 */
export const sortRequested = (table, key) => ({
  type: `${table}-table/sort-requested`,
  key,
});

/**
 * Reduce a sort action for one named table. Returns the next sort value, or
 * `undefined` when the action is not this table's sort action — so a reducer
 * branch reads as `const sort = reduceTableSort(...); if (sort) return …` with
 * no nested conditional.
 *
 * `undefined` is an unambiguous "not mine" signal because `nextTableSort`
 * always returns a freshly built `{ key, dir }` object: there is no falsy
 * sort value it can legitimately produce, and "unsorted" (`null`) is only ever
 * an initial state, never a reduction result.
 *
 * @param {TableSort | null} current
 * @param {any} action
 * @param {string} table - matches `${table}-table/sort-requested`
 * @returns {TableSort | undefined}
 */
export function reduceTableSort(current, action, table) {
  return action.type === `${table}-table/sort-requested`
    ? nextTableSort(current, action.key)
    : undefined;
}

/**
 * @template Row
 * @param {Row} row
 * @param {ColumnDescriptor<Row>} column
 * @returns {unknown}
 */
function columnValue(row, column) {
  if (typeof column.value === 'function') return column.value(row);
  return column.value
    .split('.')
    .reduce(
      (value, part) =>
        value == null
          ? undefined
          : /** @type {Record<string, unknown>} */ (value)[part],
      /** @type {unknown} */ (row)
    );
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @param {'asc' | 'desc'} direction
 * @returns {number}
 */
function compareValues(a, b, direction) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const comparison = a < b ? -1 : a > b ? 1 : 0;
  return direction === 'desc' ? -comparison : comparison;
}

/**
 * Preserve the legacy grid's cell-to-cell arrow navigation without relying on
 * test-only DOM internals. Body cells are programmatically focusable but stay
 * out of the Tab sequence; rows remain the Tab stops.
 *
 * @param {HTMLElement} table
 * @param {KeyboardEvent} event
 */
function moveGridFocus(table, event) {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key))
    return;
  const target = /** @type {HTMLTableCellElement | null} */ (
    /** @type {any} */ (event.target)?.closest?.('td') ?? null
  );
  const body = table.querySelector('tbody');
  if (!target || !body) return;

  const rows = [...body.querySelectorAll('tr')];
  const rowIndex = rows.findIndex((row) => row === target.parentNode);
  if (rowIndex < 0) return;
  const rowCells = [...rows[rowIndex].querySelectorAll('td')];
  const columnIndex = rowCells.indexOf(target);
  if (columnIndex < 0) return;

  let nextRow = rowIndex;
  let nextColumn = columnIndex;
  if (event.key === 'ArrowRight') nextColumn += 1;
  else if (event.key === 'ArrowLeft') nextColumn -= 1;
  else if (event.key === 'ArrowDown') nextRow += 1;
  else if (event.key === 'ArrowUp') nextRow -= 1;

  const next = rows[nextRow]?.querySelectorAll('td')[nextColumn];
  if (!next) return;
  event.preventDefault();
  /** @type {HTMLElement} */ (next).focus();
}

/**
 * Generic pure table renderer. Page slices own sort state and pass actions
 * back through `onSort`; the renderer owns the schema mechanics once for all
 * descriptor-driven pages.
 *
 * @template Row
 * @param {DataTableViewProps<Row>} props
 * @returns {HTMLElement}
 */
export function dataTableView({
  rows,
  footerRows = [],
  columns,
  sort,
  onSort,
  emptyMessage,
  rowKey,
  rowHref,
  onNavigate = navigateTo,
  rowClass = () => '',
}) {
  if (rows.length === 0 && footerRows.length === 0)
    return h('p', {}, emptyMessage);

  const sortColumn = sort
    ? columns.find((column) => column.key === sort.key && column.sortable)
    : undefined;
  const visibleRows = sortColumn
    ? [...rows].sort((a, b) => {
        const aValue = columnValue(a, sortColumn);
        const bValue = columnValue(b, sortColumn);
        return compareValues(aValue, bValue, sort?.dir ?? 'asc');
      })
    : rows;

  /**
   * @param {Row} row
   * @param {boolean} focusable
   * @returns {HTMLElement}
   */
  function renderRow(row, focusable) {
    const className = rowClass(row);
    /** @type {Record<string, any>} */
    const rowProps = { key: rowKey(row) };
    if (focusable) rowProps.tabindex = '0';
    if (className) rowProps.className = className;
    if (focusable && rowHref) {
      rowProps.onkeydown = (/** @type {KeyboardEvent} */ event) => {
        if (event.key === 'Enter') onNavigate(rowHref(row));
      };
    }
    return h(
      'tr',
      rowProps,
      ...columns.map((column) => {
        const value = columnValue(row, column);
        const formatted = column.format
          ? column.format(value, row)
          : value == null || value === ''
            ? '—'
            : String(value);
        const content = column.href
          ? h(
              'a',
              {
                href: column.href(row),
                'aria-label':
                  typeof column.ariaLabel === 'function'
                    ? column.ariaLabel(row)
                    : column.ariaLabel,
              },
              formatted
            )
          : formatted;
        return h(
          'td',
          focusable ? { key: column.key, tabindex: '-1' } : { key: column.key },
          content
        );
      })
    );
  }

  /** @type {HTMLElement} */
  let table;
  table = h(
    'table',
    {
      className: 'cora-data-table',
      role: 'grid',
      onkeydown: (/** @type {KeyboardEvent} */ event) =>
        moveGridFocus(table, event),
    },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        ...columns.map((column) => {
          const ariaSort =
            sort?.key === column.key
              ? sort.dir === 'asc'
                ? 'ascending'
                : 'descending'
              : 'none';
          const headerProps = {
            key: column.key,
            scope: 'col',
            'aria-sort': ariaSort,
            className: `cora-col-${column.key}`,
          };
          return h(
            'th',
            headerProps,
            column.sortable
              ? h(
                  'button',
                  { type: 'button', onclick: () => onSort(column.key) },
                  column.label
                )
              : column.label
          );
        })
      )
    ),
    h(
      'tbody',
      { className: 'cora-data-table-body' },
      ...visibleRows.map((row) => renderRow(row, true))
    ),
    footerRows.length > 0
      ? h('tfoot', {}, ...footerRows.map((row) => renderRow(row, false)))
      : null
  );
  return table;
}
