// @ts-check

/**
 * Coordinates visible tabs and active tab selection for CRCaseReview.
 */
export class CaseReviewTabController {
  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  bind(context) {
    // TODO(issue-198): Attach the cr-tab-change listener and forward selected
    // tab ids into viewModel.activeTab.
    void context;
  }

  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  update(context) {
    // TODO(issue-198): Build the six route-level tab descriptors from section
    // access and assign tabs, selected, and panels on the cr-tabs node.
    void context;
  }
}

/**
 * @param {import('./types.js').CaseReviewShellContext} context
 * @returns {import('./types.js').CaseReviewTab[]}
 */
export function buildCaseReviewTabs(context) {
  // TODO(issue-198): Preserve the current tab ids, labels, order, and hidden
  // behavior while moving the descriptor construction out of CRCaseReview.
  void context;
  return [];
}
