// @ts-check

/**
 * Owns Review-tab wiring for question answers, progress, override editor, and
 * jump-to-question interactions.
 */
export class QuestionPanelController {
  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  bind(context) {
    // TODO(issue-198): Attach cr-answer, cr-section-jump, and
    // cr-jump-unanswered listeners to the questions panel.
    void context;
  }

  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  update(context) {
    // TODO(issue-198): Assign question list props, update progress, mount the
    // override editor when access.questions is override, and preserve current
    // unanswered calculations.
    void context;
  }
}

/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/**
 * @param {import('./types.js').QuestionPanelSnapshot} snapshot
 * @returns {QuestionDefinition[]}
 */
export function collectUnansweredQuestions(snapshot) {
  // TODO(issue-198): Mirror the existing unanswered calculation used by the
  // progress component without changing array-valued answer behavior.
  void snapshot;
  return [];
}
