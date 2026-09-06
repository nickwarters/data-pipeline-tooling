// @ts-check
import { h } from '../../lib/html.js';
import { buildSummaryModel } from '../../evaluators/summary-model.js';
import { CaptureGroups } from '../../components/sections/cora-capture-groups.js';
import { categoryEyebrow } from './summary-view.js';

/**
 * The **Issues** Summary block: failed Answers with their configured
 * Remediation Actions and captured Issue detail.
 *
 * @param {import('./summary-view.js').SummaryBlockProps} props
 * @returns {HTMLElement}
 */
export function issuesSummaryView(props) {
  const { remediationActionCount, failures } = buildSummaryModel(
    props.catalogue,
    props.answers
  );

  return h(
    'section',
    { className: 'cora-summary-remediation' },
    h('h3', {}, props.heading),
    h('p', {}, `Remediation Actions: ${remediationActionCount}`),
    failures.length === 0
      ? h('p', {}, 'No failures.')
      : h('ul', {}, ...failures.map((failure) => renderFailure(props, failure)))
  );
}

/**
 * @param {import('./summary-view.js').SummaryBlockProps} props
 * @param {import('../../evaluators/summary-model.js').SummaryFailure} failure
 * @returns {HTMLElement}
 */
function renderFailure(props, failure) {
  return h(
    'li',
    {},
    categoryEyebrow(failure.category),
    failure.questionGroup
      ? h('p', { className: 'cora-remediation-group' }, failure.questionGroup)
      : null,
    h('p', { className: 'cora-remediation-question' }, failure.text),
    h(
      'p',
      { className: 'cora-remediation-answer' },
      `Answer: ${failure.answer}`
    ),
    failure.actions.length
      ? h('ul', {}, ...failure.actions.map((text) => h('li', {}, text)))
      : null,
    renderCapture(props, failure.id)
  );
}

/**
 * @param {import('./summary-view.js').SummaryBlockProps} props
 * @param {string} questionId
 * @returns {HTMLElement | null}
 */
function renderCapture(props, questionId) {
  if (!props.captureGroups?.length) return null;
  const capture = props.answers[questionId]?.capture;
  if (!capture || Object.keys(capture).length === 0) return null;

  return h(
    'div',
    { className: 'cora-summary-capture' },
    ...CaptureGroups({
      groups: props.captureGroups,
      capture,
      canCapture: false,
      namePrefix: `summary-${questionId}-`,
      collapsed: new Map(),
      // Read-only, so no picker is ever built and nothing can search.
      peopleSearch: {},
      onToggle() {},
      onCapture() {},
      onPersonQuery() {},
    })
  );
}
