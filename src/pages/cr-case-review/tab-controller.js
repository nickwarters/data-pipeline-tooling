// @ts-check

/**
 * Coordinates visible tabs and active tab selection for CRCaseReview.
 */
// TODO(simplify-ui): Collapse this controller class into plain action and
// binding functions as the Case Review page moves to function components plus
// reactive() for local-signal UI. Avoid preserving controller classes as a
// second DOM orchestration layer.
export class CaseReviewTabController {
  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  bind(context) {
    const { viewModel: vm, nodes } = context;
    if (!nodes.tabs) return;

    nodes.tabs.addEventListener('cr-tab-change', (/** @type {Event} */ ev) =>
      vm.activeTab.set(/** @type {CustomEvent} */ (ev).detail.id)
    );
  }

  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  update(context) {
    const { viewModel: vm, nodes } = context;
    if (!nodes.tabs) return;

    Object.assign(nodes.tabs, {
      tabs: buildCaseReviewTabs(context),
      selected: vm.activeTab.get(),
      panels: {
        details: nodes.details,
        questions: nodes.questionsPanel,
        remediation: nodes.remediation,
        summary: nodes.summary,
        notes: nodes.notes,
        appeal: nodes.appeal,
      },
    });
  }
}

/**
 * @param {import('./types.js').CaseReviewShellContext} context
 * @returns {import('./types.js').CaseReviewTab[]}
 */
export function buildCaseReviewTabs(context) {
  const { access } = context.viewModel;
  return [
    { id: 'details', label: 'Details', hidden: access.details === 'hidden' },
    {
      id: 'questions',
      label: 'Review',
      hidden: access.questions === 'hidden',
    },
    {
      id: 'remediation',
      label: 'Issues',
      hidden: access.remediation === 'hidden',
    },
    { id: 'summary', label: 'Summary', hidden: access.summary === 'hidden' },
    { id: 'notes', label: 'Notes', hidden: access.notes === 'hidden' },
    { id: 'appeal', label: 'Appeal', hidden: access.appeal === 'hidden' },
  ];
}
