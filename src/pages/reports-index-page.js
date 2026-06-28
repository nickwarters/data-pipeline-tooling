// @ts-check
import { h } from '../lib/html.js';

/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

/**
 * @param {{ capabilities: Capabilities }} props
 * @returns {Node[]}
 */
export function ReportsIndexPage({ capabilities }) {
  if (capabilities.isReviewerManager) {
    return [
      h(
        'div',
        { className: 'cr-report-card' },
        h('h2', {}, 'Reviewer Team Performance'),
        h('a', { href: '#/reports/reviewer-team' }, 'View report')
      ),
    ];
  }

  return [h('p', {}, "You don't have access to any reports")];
}
