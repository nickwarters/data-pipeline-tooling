// @ts-check
import { h } from '../../lib/html.js';

/**
 * The **Notes** Summary block: what the Reviewer wrote, read-only.
 *
 * @param {import('./summary-view.js').SummaryBlockProps} props
 * @returns {HTMLElement}
 */
export function notesSummaryView(props) {
  return h(
    'section',
    { className: 'cora-summary-notes' },
    h('h3', {}, props.heading),
    h('p', {}, props.caseRow.notes)
  );
}
