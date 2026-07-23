// @ts-check
import { computeQuestionGroupProgress } from '../../evaluators/question-group-progress.js';
import { isFailure } from '../../evaluators/failure-evaluator.js';
import { createMemo } from '../../core/memo.js';
import { GroupProgress } from '../../components/base/cora-group-progress.js';
import { Question } from '../../components/sections/cora-question.js';
import { h } from '../../lib/html.js';

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

/** @param {Answer|undefined} answer */
function isAnswered(answer) {
  const value = answer?.value;
  return Array.isArray(value) ? value.length > 0 : !!value;
}

/**
 * The CASE-2 Questions view owns its memo cache. Every applicable Question Group
 * is composed into one scrolling list (grouped by category/Question Group), and
 * a sticky **Question Group progress** side panel tracks answered/total per
 * group as the review is completed — clicking a group jumps to it. Each card is
 * cached on the inputs that can change its rendered subtree. `clear()` is called
 * by the route's unmount hook.
 */
export function createQuestionPanelView() {
  const memo = createMemo();

  /**
   * @param {{
   *   catalogue: QuestionDefinition[],
   *   questions: QuestionDefinition[],
   *   answers: Record<string, Answer>,
   *   access: 'edit'|'read-only'|'hidden',
   *   heading: string,
   *   onAnswer: (questionId: string, value: string|string[]) => void,
   * }} props
   */
  function render(props) {
    const { catalogue, questions, answers, access, heading, onAnswer } = props;

    const applicableIds = new Set(questions.map((question) => question.id));
    for (const question of catalogue) {
      if (!applicableIds.has(question.id)) memo.delete(question.id);
    }

    const progress = computeQuestionGroupProgress(catalogue, answers);
    const unansweredQuestions = questions.filter(
      (question) => !isAnswered(answers[question.id])
    );

    // Compose the grouped question list. Category headings (top level, only when
    // any question declares one) nest Question Group headings; each group
    // heading is a scroll anchor the progress side panel jumps to. Cards are
    // memoised on [answer, access] so an unchanged catalogue reuses nodes.
    const hasCategories = questions.some((question) => question.category);
    /** @type {Map<string, HTMLElement>} */
    const groupAnchors = new Map();
    /** @type {HTMLElement | null} */
    let firstUnanswered = null;
    /** @type {Node[]} */
    const listChildren = [];
    /** @type {string | null} */
    let prevCategory = null;
    /** @type {string | null} */
    let prevGroup = null;

    for (const question of questions) {
      const category = question.category || 'General';
      const group = questionGroupOf(question);

      if (hasCategories && category !== prevCategory) {
        listChildren.push(
          h('h3', { className: 'cora-question-category-heading' }, category)
        );
        prevGroup = null;
      }
      if (group !== prevGroup || category !== prevCategory) {
        const anchor = h(
          'div',
          { className: 'cora-question-group-heading', 'data-qgroup': group },
          h('h4', {}, group)
        );
        groupAnchors.set(group, anchor);
        listChildren.push(anchor);
      }
      prevCategory = category;
      prevGroup = group;

      const answer = answers[question.id];
      const card = memo(question.id, [answer, access], () =>
        questionCardView({ question, answer, access, onAnswer })
      );
      if (!firstUnanswered && !isAnswered(answer)) firstUnanswered = card;
      listChildren.push(card);
    }

    return h(
      'section',
      { className: 'cora-question-panel' },
      h('h2', {}, heading),
      h('div', { className: 'cora-question-list' }, ...listChildren),
      h(
        'aside',
        { className: 'cora-group-progress', 'aria-label': 'Question Groups' },
        ...GroupProgress({
          groups: progress,
          unansweredQuestions,
          onGroupJump: (group) =>
            groupAnchors
              .get(group)
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
          onJumpUnanswered: () =>
            firstUnanswered?.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            }),
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
  const questionNodes = Question({
    question,
    currentValue:
      answer?.value ?? (question.responseType === 'multi-choice' ? [] : ''),
    access,
    onAnswer: ({ questionId, value }) => onAnswer(questionId, value),
  });

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
    {
      key: question.id,
      className: 'cora-question-card',
      // The progress side panel's "Jump to next unanswered" scrolls to the
      // first card carrying this marker.
      'data-unanswered': isAnswered(answer) ? null : 'true',
    },
    ...questionNodes,
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
