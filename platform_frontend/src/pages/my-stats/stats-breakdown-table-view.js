// @ts-check

import { h } from '../../lib/html.js';

/** @typedef {import('../../evaluators/stats-report-model.js').StatsReport} StatsReport */

/** @param {number} value @returns {string} */
function percentageText(value) {
  if (value > 0 && value < 1) return '<1%';
  return `${Math.round(value)}%`;
}

/**
 * Render the Case Type breakdown at the same grain as the chart.
 *
 * @param {StatsReport} report
 * @returns {HTMLElement}
 */
export function statsBreakdownTableView(report) {
  return h(
    'section',
    {
      className: 'cora-my-stats-breakdown',
      'aria-labelledby': 'cora-my-stats-breakdown-heading',
    },
    h('h2', { id: 'cora-my-stats-breakdown-heading' }, 'Case Type breakdown'),
    h(
      'div',
      { className: 'cora-my-stats-breakdown-table-wrap' },
      h(
        'table',
        {
          className: 'cora-my-stats-breakdown-table',
        },
        h('caption', {}, `${report.range.label} Case Type breakdown`),
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, 'Period'),
            h(
              'th',
              {
                scope: 'col',
                className: 'cora-my-stats-breakdown-table__numeric',
              },
              'Total'
            ),
            report.caseTypes.flatMap(({ key, label }) => [
              h(
                'th',
                {
                  scope: 'col',
                  className: 'cora-my-stats-breakdown-table__numeric',
                },
                `${label} count`
              ),
              h(
                'th',
                {
                  scope: 'col',
                  className: 'cora-my-stats-breakdown-table__numeric',
                },
                `${label} percentage`
              ),
            ])
          )
        ),
        h(
          'tbody',
          {},
          report.buckets.map((bucket) =>
            h(
              'tr',
              { key: bucket.key },
              h('th', { scope: 'row' }, bucket.label),
              h(
                'td',
                { className: 'cora-my-stats-breakdown-table__numeric' },
                String(bucket.total)
              ),
              bucket.caseTypes.flatMap((cell) => [
                h(
                  'td',
                  { className: 'cora-my-stats-breakdown-table__numeric' },
                  String(cell.count)
                ),
                h(
                  'td',
                  { className: 'cora-my-stats-breakdown-table__numeric' },
                  percentageText(cell.percentage)
                ),
              ])
            )
          )
        )
      )
    )
  );
}
