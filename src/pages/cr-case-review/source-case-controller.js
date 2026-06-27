// @ts-check

/**
 * Owns source case rendering for QA Check cases.
 */
export class SourceCaseController {
  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  bind(context) {
    // TODO(issue-198): Add shell-level source-case event wiring here if the
    // refactor exposes any events from cr-source-case.
    void context;
  }

  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  update(context) {
    // TODO(issue-198): Assign originalRow, catalogue, computeOutcome,
    // attributeFailures, remediationFields, saveQueue, currentUser, client,
    // overrideAccess, and sourceCaseId when the view model has a source case.
    void context;
  }
}
