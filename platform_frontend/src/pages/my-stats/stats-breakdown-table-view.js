// @ts-check

import { h } from '../../lib/html.js';

/** @typedef {import('../../evaluators/stats-report-model.js').StatsReport} StatsReport */

/** @param {number} value @returns {string} */
function countText(value) {
  return String(value);
}

/** @param {number} value @returns {string} */
function percentageText(value) {
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
          'aria-describedby': 'cora-my-stats-breakdown-heading',
        },
        h('caption', {}, `${report.range.label} Case Type breakdown`),
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, 'Period'),
            h('th', { scope: 'col', className: 'is-numeric' }, 'Total'),
            report.caseTypes.flatMap(({ key, label }) => [
              h(
                'th',
                { scope: 'col', className: 'is-numeric' },
                `${label} count`
              ),
              h(
                'th',
                { scope: 'col', className: 'is-numeric' },
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
              h('td', { className: 'is-numeric' }, countText(bucket.total)),
              bucket.caseTypes.flatMap((cell) => [
                h('td', { className: 'is-numeric' }, countText(cell.count)),
                h(
                  'td',
                  { className: 'is-numeric' },
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
