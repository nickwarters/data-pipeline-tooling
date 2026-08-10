// @ts-check

import { h } from '../../lib/html.js';

/**
 * @typedef {Object} ProportionBarRow
 * @property {string} key
 * @property {string} label
 * @property {number} count
 * @property {number} share
 */

/**
 * @param {number} share
 * @returns {number}
 */
function percentageFor(share) {
  if (!Number.isFinite(share)) return 0;
  return Math.min(100, Math.max(0, share * 100));
}

/**
 * @param {number} percentage
 * @returns {string}
 */
function percentageLabel(percentage) {
  return `${Number(percentage.toFixed(2))}%`;
}

/**
 * @param {ProportionBarRow} row
 * @returns {HTMLElement}
 */
function proportionRow({ key, label, count, share }) {
  const percentage = percentageFor(share);
  const percentageText = percentageLabel(percentage);
  const description = `${label}: ${count} (${percentageText})`;
  const width = `${percentage}%`;
  const bar = h('div', {
    className: 'cora-proportion-bars-bar',
    style: `width: ${width}`,
    role: 'progressbar',
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': percentage,
    'aria-label': description,
    'aria-valuetext': description,
  });

  return h(
    'li',
    { className: 'cora-proportion-bars-row', key },
    h(
      'div',
      { className: 'cora-proportion-bars-row-heading' },
      h('span', { className: 'cora-proportion-bars-label' }, label),
      h('span', { className: 'cora-proportion-bars-count' }, count),
      h(
        'span',
        { className: 'cora-proportion-bars-percentage' },
        percentageText
      )
    ),
    h('div', { className: 'cora-proportion-bars-track' }, bar)
  );
}

/**
 * Render a semantic list of proportional Case Type-style rows. The component
 * only knows about resolved labels and numeric values; loading, ranges, and
 * display-name resolution belong to its caller.
 *
 * @param {{ rows: ProportionBarRow[], emptyStateText?: string }} props
 * @returns {HTMLElement}
 */
export function ProportionBars({ rows, emptyStateText = 'No data.' }) {
  const children = rows.length
    ? rows.map(proportionRow)
    : [h('li', { className: 'cora-proportion-bars-empty' }, emptyStateText)];

  return h('ul', { className: 'cora-proportion-bars' }, children);
}
