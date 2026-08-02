// @ts-check
import { computeQuestionGroupProgress } from '../../evaluators/question-group-progress.js';
import { isFailure } from '../../evaluators/failure-evaluator.js';
import { createMemo } from '../../core/memo.js';
import { GroupProgress } from '../../components/base/cora-group-progress.js';
import {
  GroupOutcomeControl,
  groupOutcomeTargets,
  groupOutcomeValue,
  questionGroupOf,
} from './group-outcome-view.js';
import { h } from '../../lib/html.js';
import {
  NA_VALUE,
  reviewerResponseOptions,
} from '../../lib/response-options.js';

/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/**
 * Option text longer than this many characters triggers the stacked-card
 * layout (`cora-question-options-long`) instead of the default inline
 * pill layout, so sentence-length single-choice options (e.g. `outcome`
 * wordings) remain readable.
 */
const LONG_OPTION_THRESHOLD = 40;

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
 * The Questions view owns its memo cache. Every applicable Question Group
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
   *   questionGroups?: Record<string, import('../../sharepoint-client.js').QuestionGroupConfig>,
   *   allowBulkOutcome?: boolean,
   *   onAnswer: (questionId: string, value: string|string[]) => void,
   *   onGroupOutcome: (questionGroup: string, value: string) => void,
   * }} props
   */
  function view(props) {
    const {
      catalogue,
      questions,
      answers,
      access,
      heading,
      questionGroups,
      allowBulkOutcome,
      onAnswer,
      onGroupOutcome,
    } = props;

    const applicableIds = new Set(questions.map((question) => question.id));
    for (const question of catalogue) {
      if (!applicableIds.has(question.id)) memo.delete(question.id);
    }

    const progress = computeQuestionGroupProgress(catalogue, answers);
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
        // `questions` is already the applicable set, so an opted-in group whose
        // Outcome Questions are all hidden right now offers no control rather
        // than one that would write nothing.
        const targets = groupOutcomeTargets(questions, group);
        const offerOutcome =
          access === 'edit' &&
          (questionGroups?.[group]?.allowBulkOutcome ?? allowBulkOutcome) ===
            true &&
          targets.length > 0;
        const anchor = h(
          'div',
          { className: 'cora-question-group-heading', 'data-qgroup': group },
          h('h4', {}, group),
          offerOutcome
            ? GroupOutcomeControl({
                questionGroup: group,
                options: reviewerResponseOptions(targets[0]),
                value: groupOutcomeValue(targets, answers),
                onGroupOutcome,
              })
            : null
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
    view,
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
  const hasLongOption =
    !isMulti && options.some((option) => option.length > LONG_OPTION_THRESHOLD);
  const fieldsetClass = hasLongOption
    ? 'cora-question cora-question-options-long'
    : 'cora-question';
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
        onchange: (/** @type {any} */ event) => {
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
    {
      key: question.id,
      className: 'cora-question-card',
      // The progress side panel's "Jump to next unanswered" scrolls to the
      // first card carrying this marker.
      'data-unanswered': isAnswered(answer) ? null : 'true',
    },
    h(
      'fieldset',
      {
        className: fieldsetClass,
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
