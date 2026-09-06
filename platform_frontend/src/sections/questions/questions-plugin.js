// src/sections/questions/questions-plugin.js
// @ts-check
import { isFrozen } from '../../evaluators/case-lifecycle.js';
import { withGeneralQuestions } from '../../pages/cora-case-review/general-questions-view.js';
import { resolveGeneralQuestionsPlacement } from '../../evaluators/general-questions.js';
import { groupOutcomeSet } from '../../pages/cora-case-review/answer-actions.js';
import { questionsSummaryView } from '../../pages/cora-case-review/questions-summary-view.js';

/**
 * @param {import('../../pages/cora-case-review.js').CaseReviewSnapshot} snapshot
 * @param {ReturnType<typeof import('../../pages/cora-case-review/question-panel-view.js').createQuestionPanelView>} questionsView
 * @param {(questionId: string, value: string | string[]) => void} [onAnswer]
 * @param {(questionGroup: string, value: string) => void} [onGroupOutcome]
 * @returns {Node[]}
 */
function questionsPanel(snapshot, questionsView, onAnswer, onGroupOutcome) {
  return withGeneralQuestions(
    questionsView.view({
      catalogue: snapshot?.catalogue ?? [],
      questions: snapshot?.applicableQuestions ?? [],
      answers: snapshot?.answers ?? {},
      access: snapshot?.access?.questions ?? 'edit',
      heading: snapshot?.sectionLabels?.questions?.heading ?? 'Questions',
      questionGroups: snapshot?.config?.questionGroups,
      allowBulkOutcome: snapshot?.config?.allowBulkOutcome,
      onAnswer: onAnswer ?? (() => {}),
      onGroupOutcome: onGroupOutcome ?? (() => {}),
    }),
    {
      fields: snapshot?.config?.generalQuestions ?? [],
      answers: snapshot?.answers ?? {},
      access: snapshot?.access?.questions ?? 'edit',
      placement: resolveGeneralQuestionsPlacement(snapshot?.config),
      onAnswer: onAnswer ?? (() => {}),
    }
  );
}

/** @satisfies {import('../contract.js').SectionPlugin} */
export const QuestionsPlugin = /** @type {const} */ ({
  id: 'questions',
  tab: true,
  tabOrder: 2,
  summaryBlock: true,
  summaryOrder: 2,
  showInSummaryDefault: true,
  defaultLabels: { tab: 'Review', heading: 'Questions' },

  evaluateAccess({ caseRow, roles }) {
    if (roles.includes('assignedReviewer')) {
      return caseRow?.status && isFrozen(caseRow.status) ? 'read-only' : 'edit';
    }
    const readOnlyRoles = [
      'otherReviewer',
      'reviewerManager',
      'caseTypeOwner',
      'journeyOwner',
      'controls',
    ];
    if (roles.some((role) => readOnlyRoles.includes(role))) {
      return 'read-only';
    }
    return 'hidden';
  },

  summaryView: questionsSummaryView,

  view({ snapshot, actions }) {
    if (typeof actions?.questionsView?.view !== 'function') {
      throw new Error(
        'QuestionsPlugin requires actions.questionsView with a view method'
      );
    }
    return questionsPanel(
      snapshot,
      actions.questionsView,
      actions?.onAnswer,
      (questionGroup, value) =>
        actions?.editAnswers?.(
          groupOutcomeSet({
            answers: actions.currentAnswers(),
            catalogue: snapshot?.catalogue ?? [],
            questionGroup,
            value,
            canEdit: snapshot?.access?.questions === 'edit',
          })
        )
    );
  },
});
