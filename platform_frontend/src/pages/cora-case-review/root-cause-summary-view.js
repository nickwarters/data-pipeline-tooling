// @ts-check
import { h } from '../../lib/html.js';
import { failedIssues } from '../../evaluators/remediation-status.js';
import {
  unfilledRequiredCapture,
  unfilledRequiredFields,
} from '../../evaluators/issue-capture.js';
import { CaptureGroups } from '../../components/sections/cora-capture-groups.js';
import { caseRootCauseCapture } from '../../evaluators/case-root-cause.js';

/**
 * The **Root Cause** Summary block: what the Responsible Party Manager has
 * recorded about the Case and against each Issue, read-only, and whether any
 * required field of either family is still empty.
 *
 * @param {import('./summary-view.js').SummaryBlockProps} props
 * @returns {HTMLElement}
 */
export function rootCauseSummaryView(props) {
  const groups = props.rootCauseGroups ?? [];
  const caseGroups = props.rootCauseCaseGroups ?? [];
  const caseCapture = caseRootCauseCapture(props.answers);
  const recorded = failedIssues(props.catalogue, props.answers).filter(
    ({ answer }) => Object.keys(answer.rcaCapture ?? {}).length > 0
  );
  const outstanding =
    unfilledRequiredFields(caseGroups, caseCapture).length > 0 ||
    unfilledRequiredCapture(
      props.catalogue,
      props.answers,
      groups,
      'rcaCapture'
    );

  return h(
    'section',
    { className: 'cora-summary-root-cause' },
    h('h3', {}, props.heading),
    outstanding
      ? h(
          'p',
          { className: 'cora-root-cause-outstanding' },
          'Required root cause details are still to be recorded.'
        )
      : null,
    caseGroups.length > 0 ? caseSummary(caseGroups, caseCapture) : null,
    groups.length === 0
      ? null
      : recorded.length === 0
        ? h('p', {}, 'No root cause recorded.')
        : h(
            'ul',
            {},
            ...recorded.map(({ question, answer }) =>
              h(
                'li',
                {},
                h(
                  'p',
                  { className: 'cora-remediation-question' },
                  question.text
                ),
                ...CaptureGroups({
                  groups,
                  capture: answer.rcaCapture ?? {},
                  canCapture: false,
                  namePrefix: `summary-rc-${question.id}-`,
                  collapsed: new Map(),
                  peopleSearch: {},
                  onToggle() {},
                  onCapture() {},
                  onPersonQuery() {},
                })
              )
            )
          )
  );
}

/**
 * The Case Root Cause Fields, read-only, or a line saying none is recorded.
 *
 * @param {import('../../sharepoint-client.js').CaptureGroup[]} groups
 * @param {NonNullable<import('../../sharepoint-client.js').Answer['rcaCapture']>} capture
 * @returns {HTMLElement}
 */
function caseSummary(groups, capture) {
  const fields = CaptureGroups({
    groups,
    capture,
    canCapture: false,
    namePrefix: 'summary-rc-case-',
    collapsed: new Map(),
    peopleSearch: {},
    onToggle() {},
    onCapture() {},
    onPersonQuery() {},
  });
  return h(
    'div',
    { className: 'cora-summary-root-cause-case' },
    h('h4', {}, 'About this Case'),
    ...(fields.length > 0
      ? fields
      : [h('p', {}, 'Nothing recorded about this Case.')])
  );
}
