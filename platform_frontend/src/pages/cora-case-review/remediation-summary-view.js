// @ts-check
import { h } from '../../lib/html.js';
import {
  REMEDIATION_DETAIL_LABELS,
  REMEDIATION_STATUS_LABELS,
  remediationRows,
} from '../../evaluators/remediation-status.js';
import { COPY as REMEDIATION_COPY } from './remediation-tracking-view.js';
import { categoryEyebrow } from './summary-view.js';

/**
 * The **Remediation** tracking Summary block: the case-level
 * `remediationDueDate` plus one entry per *Question* carrying remediation, with
 * how the Reviewer resolved it.
 *
 * It reads `remediationRows` — the same rows the Remediation tab renders, so
 * the two tabs of one Case cannot contradict each other.
 *
 * The resolution's *details / justification* follows the **audience**, exactly
 * as the Remediation tab does: withheld from the `responsibleParty` side, whose
 * rendering strips the Reviewer's record-of-truth fields, and shown
 * to reviewer-side observers, whose `!canResolve` branch on the tab renders it.
 *
 * @param {import('./summary-view.js').SummaryBlockProps} props
 * @returns {HTMLElement}
 */
export function remediationSummaryView(props) {
  const rows = remediationRows(props.catalogue, props.answers);
  const dueDate = props.caseRow?.remediationDueDate;
  // Absent audience means the narrower rendering: a caller that has not said who
  // is reading does not get to leak the Reviewer's fields.
  const reviewerSide = props.audience === 'reviewer';

  return h(
    'section',
    { className: 'cora-summary-remediation-tracking' },
    h('h3', {}, props.heading),
    h(
      'p',
      {},
      dueDate
        ? `Remediation due: ${dueDate}`
        : REMEDIATION_COPY.remediationDueNone
    ),
    rows.length === 0
      ? h('p', {}, REMEDIATION_COPY.noActionsSent)
      : h('ul', {}, ...rows.map((row) => renderTrackedRow(row, reviewerSide)))
  );
}

/**
 * @param {import('../../evaluators/remediation-status.js').RemediationRow} row
 * @param {boolean} reviewerSide Whether to show the resolution's details / justification.
 * @returns {HTMLElement}
 */
function renderTrackedRow(row, reviewerSide) {
  const { question } = row;
  const detailed =
    reviewerSide && row.status && row.status !== 'complete' && row.details;
  return h(
    'li',
    {},
    categoryEyebrow(question.category),
    question.questionGroup
      ? h('p', { className: 'cora-remediation-group' }, question.questionGroup)
      : null,
    h('p', { className: 'cora-remediation-question' }, question.text),
    h(
      'ul',
      {},
      ...row.actions.map((action) => h('li', {}, action.text)),
      ...(row.freeForm ? [h('li', {}, row.freeForm)] : [])
    ),
    h(
      'p',
      {},
      row.status
        ? `Status: ${REMEDIATION_STATUS_LABELS[row.status]}`
        : REMEDIATION_COPY.awaitingReviewer
    ),
    detailed
      ? h(
          'p',
          { className: 'cora-summary-tracking-details' },
          `${REMEDIATION_DETAIL_LABELS[/** @type {'partial' | 'cancelled'} */ (row.status)]}: ${row.details}`
        )
      : null
  );
}
