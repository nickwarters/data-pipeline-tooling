// @ts-check
import { computeSectionProgress } from '../../evaluators/section-progress.js';
import { h } from '../../lib/html.js';

/**
 * Owns Review-tab wiring for question answers, progress, override editor, and
 * jump-to-question interactions.
 */
export class QuestionPanelController {
  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  bind(context) {
    const { viewModel: vm, nodes } = context;
    const questionsPanel = nodes.questionsPanel;
    const questionList = /** @type {any} */ (nodes.questionList);
    if (!questionsPanel || !questionList) return;

    questionsPanel.addEventListener('cr-answer', (ev) => {
      const event = /** @type {CustomEvent} */ (ev);
      vm.handleAnswer(
        /** @type {any} */ (event).detail.questionId,
        /** @type {any} */ (event).detail.value
      );
    });
    questionsPanel.addEventListener('cr-section-jump', (ev) => {
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
    questionsPanel.addEventListener('cr-jump-unanswered', () => {
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
  update(context) {
    const { viewModel: vm } = context;
    const { questionList, progress, overrideEditor, questionsPanel } =
      context.nodes;
    const { caseRow, catalogue, config, answersSignal, currentUser, access } =
      vm;
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

    const questionsChildren = [
      h('h2', {}, 'Questions'),
      questionList,
      progress,
    ];
    if (access.questions === 'override' && overrideEditor) {
      Object.assign(overrideEditor, {
        caseRow,
        saveQueue: vm.saveQueue,
        caseId: caseRow.id,
        access: 'override',
        currentUser,
        catalogue,
        attributeFailures: config.attributeFailures === true,
        remediationFields: config.remediationFields ?? [],
        computeOutcome: config.computeOutcome,
        client: vm.client,
      });
      questionsChildren.push(overrideEditor);
    }

    if (typeof questionsPanel.replaceChildren === 'function') {
      questionsPanel.replaceChildren(...questionsChildren);
    } else {
      /** @type {any} */ (questionsPanel)._children = questionsChildren;
    }
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
