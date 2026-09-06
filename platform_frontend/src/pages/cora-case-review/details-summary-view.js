// @ts-check
import { caseDetailFields } from './details-view.js';
import { renderFieldBlock } from './summary-view.js';

/**
 * The **Case Details** Summary block: the Case Type's configured detail fields,
 * displayed exactly as the Details tab displays them.
 *
 * Reads `caseDetailFields` rather than the Case row directly, so the two tabs
 * of one Case show the same fields with the same formatting — the tab is the
 * only place that decides what a detail field looks like.
 *
 * @param {import('./summary-view.js').SummaryBlockProps} props
 * @returns {HTMLElement}
 */
export function detailsSummaryView(props) {
  return renderFieldBlock(
    'cora-summary-details',
    props.heading,
    caseDetailFields(props.caseRow, props.detailFields).map((field) => ({
      label: field.label,
      display: field.display,
    }))
  );
}
