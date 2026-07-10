// @ts-check
import { computeSectionProgress } from '../../evaluators/section-progress.js';
import { h } from '../../lib/html.js';
import { resolveSectionHeadings } from '../../lib/section-labels.js';

/**
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function bindQuestionPanel(context) {
  const { viewModel: vm, nodes } = context;
  const questionsPanel = nodes.questionsPanel;
  const questionList = /** @type {any} */ (nodes.questionList);
  if (!questionsPanel || !questionList) return;

  questionsPanel.addEventListener('cora-answer', (ev) => {
    const event = /** @type {CustomEvent} */ (ev);
    vm.handleAnswer(
      /** @type {any} */ (event).detail.questionId,
      /** @type {any} */ (event).detail.value
    );
  });
  questionsPanel.addEventListener('cora-section-jump', (ev) => {
    const event = /** @type {CustomEvent} */ (ev);
    const sectionName = /** @type {any} */ (event).detail.section;
    const children = questionList.questionElements ?? [];
    const target = children.find(
      (/** @type {any} */ c) =>
        c.question?.category === sectionName ||
        (!c.question?.category && sectionName === 'General')
    );
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  });
  questionsPanel.addEventListener('cora-jump-unanswered', () => {
    const children = questionList.questionElements ?? [];
    const target = children.find((/** @type {any} */ c) => {
      if (!c.question) return false;
      const v = vm.answersSignal.get()[c.question.id]?.value;
      return Array.isArray(v) ? v.length === 0 : !v;
    });
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  });
}

/**
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function updateQuestionPanel(context) {
  const { viewModel: vm } = context;
  const { questionList, progress, questionsPanel } = context.nodes;
  const { caseRow, catalogue, config, answersSignal, currentUser, access } = vm;
  if (
    !caseRow ||
    !config ||
    !currentUser ||
    !questionList ||
    !progress ||
    !questionsPanel
  ) {
    return;
  }

  const questions = vm.applicableQuestions.get();
  const answers = answersSignal.get();

  Object.assign(questionList, {
    access: context.displayMode(access.questions),
    questions,
    answers,
  });
  if (/** @type {any} */ (questionList).update) {
    /** @type {any} */ (questionList).update(questions, answers);
  }

  const unanswered = collectUnansweredQuestions({
    questions,
    answers,
    catalogue,
  });
  if (/** @type {any} */ (progress).update) {
    /** @type {any} */ (progress).update(
      computeSectionProgress(catalogue, answers),
      unanswered
    );
  }

  // Prefer the view model's resolved headings; fall back to resolving from the
  // config so the controller stays usable with minimal contexts.
  const headings = vm.sectionHeadings ?? resolveSectionHeadings(config);
  const questionsChildren = [
    h('h2', {}, headings.questions),
    questionList,
    progress,
  ];

  if (typeof questionsPanel.replaceChildren === 'function') {
    questionsPanel.replaceChildren(...questionsChildren);
  } else {
    /** @type {any} */ (questionsPanel)._children = questionsChildren;
  }
}

/**
 * @deprecated Use bindQuestionPanel() and updateQuestionPanel().
 */
export class QuestionPanelController {
  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  bind(context) {
    bindQuestionPanel(context);
  }

  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  update(context) {
    updateQuestionPanel(context);
  }
}

/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/**
 * @param {import('./types.js').QuestionPanelSnapshot} snapshot
 * @returns {QuestionDefinition[]}
 */
export function collectUnansweredQuestions(snapshot) {
  return snapshot.questions.filter((q) => {
    const v = snapshot.answers[q.id]?.value;
    return Array.isArray(v) ? v.length === 0 : !v;
  });
}
