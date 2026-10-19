// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import { failedIssues } from '../../evaluators/remediation-status.js';
import { unfilledRequiredFields } from '../../evaluators/issue-capture.js';
import { CaptureGroups } from '../../components/sections/cora-capture-groups.js';

/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').CaptureGroup} CaptureGroup */
/** @typedef {import('../../evaluators/issue-capture.js').CaptureValue} CaptureValue */

/**
 * @typedef {object} RootCauseSectionProps
 * @property {string} heading The Section's resolved heading.
 * @property {QuestionDefinition[]} catalogue
 * @property {Record<string, Answer>} answers
 * @property {CaptureGroup[]} groups The Case Type's `rootCauseGroups`.
 * @property {Record<string, Map<string, boolean>>} collapsed
 *   Per Issue, the groups the viewer has opened or shut.
 * @property {boolean} canEdit Whether the viewer may write the Root Cause.
 * @property {(questionId: string, fieldKey: string, value: CaptureValue | null) => void} dispatchCapture
 * @property {(questionId: string, groupKey: string, collapsed: boolean) => void} dispatchToggle
 */

/**
 * The Root Cause tab: one item per Issue, in catalogue order, each carrying the
 * Case Type's Root Cause Fields over that Answer's `rcaCapture`.
 *
 * A required field still empty is named under its Issue for every viewer, so a
 * Reviewer reading the tab can see what the manager has yet to record. It holds
 * nothing: no transition waits on it.
 *
 * @param {RootCauseSectionProps} props
 * @returns {Node[]}
 */
export function RootCauseSection(props) {
  const heading = h('h2', {}, props.heading);
  const issues = failedIssues(props.catalogue, props.answers);
  if (issues.length === 0) {
    return [
      heading,
      EmptyState('No Issues.', { className: 'cora-root-cause-empty' }),
    ];
  }

  const list = h('ul', { className: 'cora-root-cause-list' });
  for (const { question, answer } of issues) {
    list.appendChild(renderIssue(props, question, answer));
  }
  return [heading, list];
}

/**
 * @param {RootCauseSectionProps} props
 * @param {QuestionDefinition} q
 * @param {Answer} answer
 * @returns {HTMLElement}
 */
function renderIssue(props, q, answer) {
  const rca = answer.rcaCapture ?? {};
  const v = answer.value;
  const li = h(
    'li',
    { className: 'cora-root-cause-item', key: q.id },
    q.questionGroup
      ? h('p', { className: 'cora-remediation-group' }, q.questionGroup)
      : null,
    h('p', { className: 'cora-remediation-question' }, q.text),
    h(
      'p',
      { className: 'cora-remediation-answer' },
      `Answer: ${Array.isArray(v) ? v.join(', ') : v}`
    )
  );

  const outstanding = unfilledRequiredFields(props.groups, rca);
  if (outstanding.length > 0) {
    li.appendChild(
      h(
        'p',
        { className: 'cora-root-cause-outstanding' },
        `Still to record: ${outstanding.map((f) => f.label).join(', ')}`
      )
    );
  }

  const fields = CaptureGroups({
    groups: props.groups,
    capture: rca,
    canCapture: props.canEdit,
    namePrefix: `rc-${q.id}-`,
    collapsed: props.collapsed[q.id] ?? new Map(),
    onToggle: (groupKey, next) => props.dispatchToggle(q.id, groupKey, next),
    // Person fields are refused in Root Cause groups, so no picker is built.
    peopleSearch: {},
    onCapture: (fieldKey, value) =>
      props.dispatchCapture(q.id, fieldKey, value),
    onPersonQuery() {},
  });
  if (fields.length === 0) {
    li.appendChild(
      h('p', { className: 'cora-root-cause-none' }, 'No root cause recorded.')
    );
  }
  li.append(...fields);
  return li;
}
