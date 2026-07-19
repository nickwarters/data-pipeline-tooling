// @ts-check
import { computeQuestionGroupProgress } from '../../evaluators/question-group-progress.js';
import { isFailure } from '../../evaluators/failure-evaluator.js';
import { createMemo } from '../../core/memo.js';
import { h } from '../../lib/html.js';
import {
  NA_VALUE,
  reviewerResponseOptions,
} from '../../lib/response-options.js';

/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/** @param {QuestionDefinition} question */
export function questionGroupOf(question) {
  return question.questionGroup || 'General';
}

/** @param {QuestionDefinition[]} questions */
export function questionGroupsOf(questions) {
  return [...new Set(questions.map(questionGroupOf))];
}

/**
 * The CASE-2 Questions view owns its memo cache. Only the active Question Group
 * is composed, and each card is cached on the inputs that can change its
 * rendered subtree. `clear()` is called by the route's unmount hook.
 */
export function createQuestionPanelView() {
  const memo = createMemo();

  /**
   * @param {{
   *   catalogue: QuestionDefinition[],
   *   questions: QuestionDefinition[],
   *   answers: Record<string, Answer>,
   *   activeGroup: string,
   *   access: 'edit'|'read-only'|'hidden',
   *   heading: string,
   *   onAnswer: (questionId: string, value: string|string[]) => void,
   *   onGroupSelected: (group: string) => void,
   * }} props
   */
  function render(props) {
    const groups = questionGroupsOf(props.questions);
    const activeGroup = groups.includes(props.activeGroup)
      ? props.activeGroup
      : (groups[0] ?? '');
    const visibleQuestions = props.questions.filter(
      (question) => questionGroupOf(question) === activeGroup
    );
    const visibleIds = new Set(visibleQuestions.map((question) => question.id));

    for (const question of props.catalogue) {
      if (!visibleIds.has(question.id)) memo.delete(question.id);
    }

    const progress = computeQuestionGroupProgress(
      props.catalogue,
      props.answers
    );

    return h(
      'section',
      { className: 'cora-question-panel' },
      h('h2', {}, props.heading),
      h(
        'div',
        {
          className: 'cora-question-groups',
          'aria-label': 'Question Groups',
        },
        ...groups.map((group) => {
          const selected = group === activeGroup;
          const groupProgress = progress.find((entry) => entry.group === group);
          return h(
            'button',
            {
              key: `question-group-${group}`,
              className: 'cora-question-group-tab',
              'aria-current': selected ? 'true' : null,
              onClick: () => props.onGroupSelected(group),
            },
            `${group} ${groupProgress?.answered ?? 0}/${groupProgress?.total ?? 0}`
          );
        })
      ),
      h(
        'div',
        {
          className: 'cora-question-group-panel',
          'data-question-group': activeGroup,
        },
        ...visibleQuestions.map((question) => {
          const answer = props.answers[question.id];
          // Applicability is represented by presence in `visibleQuestions`;
          // inapplicable and off-group cards are evicted above. Labels and
          // Outcome options are not rendered by this answering-path card.
          return memo(question.id, [answer, props.access], () =>
            questionCardView({
              question,
              answer,
              access: props.access,
              onAnswer: props.onAnswer,
            })
          );
        })
      )
    );
  }

  return {
    render,
    clear: memo.clear,
    get cacheSize() {
      return memo.size;
    },
  };
}

/**
 * @param {{
 *   question: QuestionDefinition,
 *   answer: Answer|undefined,
 *   access: 'edit'|'read-only'|'hidden',
 *   onAnswer: (questionId: string, value: string|string[]) => void,
 * }} props
 */
export function questionCardView({ question, answer, access, onAnswer }) {
  const options = reviewerResponseOptions(question);
  const isMulti = question.responseType === 'multi-choice';
  const value = answer?.value ?? (isMulti ? [] : '');
  const selected = new Set(Array.isArray(value) ? value : []);
  const controls = options.map((option, index) =>
    h(
      'label',
      { className: 'cora-question-option' },
      h('input', {
        type: isMulti ? 'checkbox' : 'radio',
        name: `cora-q-${question.id}`,
        value: option,
        'data-focus-key': `answer:${question.id}:${index}`,
        checked: isMulti ? selected.has(option) : value === option,
        disabled: access !== 'edit',
        onChange: (/** @type {any} */ event) => {
          if (access !== 'edit') return;
          if (!isMulti) {
            onAnswer(question.id, option);
            return;
          }
          const next = new Set(selected);
          if (event.target.checked) next.add(option);
          else next.delete(option);
          if (event.target.checked) {
            if (option === NA_VALUE) {
              next.clear();
              next.add(NA_VALUE);
            } else {
              next.delete(NA_VALUE);
            }
          }
          onAnswer(
            question.id,
            options.filter((candidate) => next.has(candidate))
          );
        },
      }),
      h('span', {}, ` ${option}`)
    )
  );

  const remediation = isFailure(question, answer)
    ? [
        ...(answer?.remediationActions ?? []).map((action) =>
          h('li', {}, action.text)
        ),
        ...(answer?.freeFormRemediation
          ? [h('li', {}, answer.freeFormRemediation)]
          : []),
      ]
    : [];

  return h(
    'article',
    { key: question.id, className: 'cora-question-card' },
    h(
      'fieldset',
      {
        id: `cora-q-${question.id}`,
        role: isMulti ? 'group' : 'radiogroup',
        'aria-required': 'true',
      },
      h('legend', {}, question.text),
      ...controls
    ),
    remediation.length
      ? h(
          'div',
          { className: 'cora-question-remediation' },
          h('p', {}, 'Selected remediation'),
          h('ul', {}, ...remediation)
        )
      : null
  );
}
