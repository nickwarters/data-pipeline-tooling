// @ts-check
import { h } from '../../lib/html.js';
import { paint } from '../charts/chart-kit.js';
import { dataTableView } from '../../views/data-table.js';

/** @typedef {import('../../reports/contract.js').ReportPanelSpec} ReportPanelSpec */
/** @typedef {import('../../views/data-table.js').TableSort} TableSort */

const SPANS = Object.freeze([3, 4, 5, 6, 7, 8, 9, 12]);

/**
 * @param {ReportPanelSpec['legend']} legend
 * @returns {HTMLElement | null}
 */
function legendView(legend) {
  if (!legend || legend.length === 0) return null;
  return h(
    'ul',
    { className: 'cora-report-legend', key: 'legend' },
    legend.map((item) =>
      h(
        'li',
        { key: item.label },
        h('span', {
          className: `cora-report-legend__key cora-report-legend__key--${item.shape ?? 'swatch'}`,
          style: `background: ${paint(item.role)}`,
          'aria-hidden': 'true',
        }),
        item.label
      )
    )
  );
}

/**
 * @param {ReportPanelSpec} spec
 * @param {{
 *   width: number,
 *   span: number,
 *   showTable: boolean,
 *   sort: TableSort | null,
 *   onToggleTable: (panelId: string) => void,
 *   onSort: (panelId: string, key: string) => void,
 * }} options
 * @returns {HTMLElement}
 */
export function ReportPanel(
  spec,
  { width, span, showTable, sort, onToggleTable, onSort }
) {
  const columns = SPANS.includes(span) ? span : 12;
  const titleId = `cora-report-panel-${spec.id}`;
  const table = spec.table;
  const tableShowing = showTable && table !== undefined;

  return h(
    'section',
    {
      className: `cora-report-panel cora-report-panel--span-${columns}`,
      key: spec.id,
      'aria-labelledby': titleId,
    },
    h(
      'div',
      { className: 'cora-report-panel__head', key: 'head' },
      h(
        'h3',
        { className: 'cora-report-panel__title', id: titleId },
        spec.title
      ),
      h(
        'div',
        { className: 'cora-report-panel__tools' },
        (spec.chips ?? []).map((chip) =>
          h('span', { className: 'cora-report-panel__chip', key: chip }, chip)
        ),
        table
          ? h(
              'button',
              {
                className: 'cora-report-panel__toggle',
                key: 'toggle',
                'aria-pressed': String(tableShowing),
                onclick: () => onToggleTable(spec.id),
              },
              tableShowing ? 'Chart' : 'Table'
            )
          : null
      )
    ),
    spec.subtitle
      ? h(
          'p',
          { className: 'cora-report-panel__subtitle', key: 'subtitle' },
          spec.subtitle
        )
      : null,
    tableShowing ? null : legendView(spec.legend),
    h(
      'div',
      {
        className: `cora-report-panel__body${tableShowing ? ' cora-report-panel__body--table' : ''}`,
        key: tableShowing ? 'table' : 'chart',
      },
      tableShowing
        ? dataTableView({
            rows: table.rows,
            columns: table.columns.map((column) => ({
              ...column,
              sortable: column.sortable ?? true,
            })),
            sort,
            onSort: (key) => onSort(spec.id, key),
            emptyMessage: 'No rows.',
            rowKey: table.rowKey,
          })
        : spec.render(width)
    ),
    spec.note
      ? h('p', { className: 'cora-report-panel__note', key: 'note' }, spec.note)
      : null
  );
}
