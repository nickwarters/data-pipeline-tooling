// @ts-check

/**
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function bindCaseReviewTabs(context) {
  const { viewModel: vm, nodes } = context;
  if (!nodes.tabs) return;

  nodes.tabs.addEventListener('cr-tab-change', (/** @type {Event} */ ev) =>
    vm.activeTab.set(/** @type {CustomEvent} */ (ev).detail.id)
  );
}

/**
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function updateCaseReviewTabs(context) {
  const { viewModel: vm, nodes } = context;
  if (!nodes.tabs) return;

  Object.assign(nodes.tabs, {
    tabs: buildCaseReviewTabs(context),
    selected: vm.activeTab.get(),
    panels: {
      details: nodes.details,
      questions: nodes.questionsPanel,
      issues: nodes.issues,
      remediation: nodes.remediation,
      summary: nodes.summary,
      notes: nodes.notes,
      appealRequest: nodes.appeal,
    },
  });
}

/**
 * @deprecated Use bindCaseReviewTabs() and updateCaseReviewTabs().
 */
export class CaseReviewTabController {
  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  bind(context) {
    bindCaseReviewTabs(context);
  }

  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  update(context) {
    updateCaseReviewTabs(context);
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
      id: 'issues',
      label: 'Issues',
      hidden: access.issues === 'hidden',
    },
    {
      id: 'remediation',
      label: 'Remediation',
      hidden: access.remediation === 'hidden',
    },
    { id: 'summary', label: 'Summary', hidden: access.summary === 'hidden' },
    { id: 'notes', label: 'Notes', hidden: access.notes === 'hidden' },
    {
      id: 'appealRequest',
      label: 'Appeal',
      hidden: access.appealRequest === 'hidden',
    },
  ];
}
