// @ts-check

/**
 * Owns property assignment for Summary, Notes, and Appeal tabs.
 */
export class SummaryNotesAppealController {
  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  bind(context) {
    // TODO(issue-198): Add event wiring here if these tab surfaces gain
    // shell-level events during the refactor.
    void context;
  }

  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  update(context) {
    // TODO(issue-198): Assign summary, notes, and appeal properties exactly as
    // CRCaseReview does today, including allAnswered and qaReviewer handling.
    void context;
  }
}
