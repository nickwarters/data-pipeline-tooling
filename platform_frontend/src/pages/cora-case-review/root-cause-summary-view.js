// @ts-check
import { h } from '../../lib/html.js';
import { failedIssues } from '../../evaluators/remediation-status.js';
import { unfilledRequiredCapture } from '../../evaluators/issue-capture.js';
import { CaptureGroups } from '../../components/sections/cora-capture-groups.js';

/**
 * The **Root Cause** Summary block: what the Responsible Party Manager has
 * recorded against each Issue, read-only, and whether any required Root Cause
 * Field is still empty.
 *
 * @param {import('./summary-view.js').SummaryBlockProps} props
 * @returns {HTMLElement}
 */
export function rootCauseSummaryView(props) {
  const groups = props.rootCauseGroups ?? [];
  const recorded = failedIssues(props.catalogue, props.answers).filter(
    ({ answer }) => Object.keys(answer.rcaCapture ?? {}).length > 0
  );
  const outstanding = unfilledRequiredCapture(
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
    recorded.length === 0
      ? h('p', {}, 'No root cause recorded.')
      : h(
          'ul',
          {},
          ...recorded.map(({ question, answer }) =>
            h(
              'li',
              {},
              h('p', { className: 'cora-remediation-question' }, question.text),
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
