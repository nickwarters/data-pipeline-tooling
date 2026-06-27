// @ts-check

/**
 * Owns Complete Case button state and completion submission.
 */
export class CompletionController {
  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  bind(context) {
    // TODO(issue-198): Attach the complete button click handler, disable during
    // completion, build transitionToCompleted patch fields when available, and
    // call context.completeCase.
    void context;
  }

  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  update(context) {
    // TODO(issue-198): Keep button visibility and label aligned with
    // allAnswered and machine.canComplete.
    void context;
  }
}

/**
 * @param {import('./types.js').CompletionRequest} request
 * @returns {Promise<void>}
 */
export async function completeCase(request) {
  // TODO(issue-198): Move CRCaseReview._completeCase behavior here: flush queued
  // saves, patch the case with the current ETag, and navigate to dashboard only
  // on successful patch.
  void request;
}
