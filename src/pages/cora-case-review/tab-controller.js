// @ts-check
import { resolveSectionLabels } from '../../lib/section-labels.js';

/**
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function bindCaseReviewTabs(context) {
  const { viewModel: vm, nodes } = context;
  if (!nodes.tabs) return;

  nodes.tabs.addEventListener('cora-tab-change', (/** @type {Event} */ ev) =>
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
      appealReview: nodes.appealReview,
      amendOutcome: nodes.amendOutcome,
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
  const { access, config, sectionLabels } = context.viewModel;
  // Prefer the view model's already-resolved labels; fall back to resolving
  // from the config so the builder stays usable with minimal contexts.
  const labels = sectionLabels ?? resolveSectionLabels(config);
  return [
    {
      id: 'details',
      label: labels.details,
      hidden: access.details === 'hidden',
    },
    {
      id: 'questions',
      label: labels.questions,
      hidden: access.questions === 'hidden',
    },
    {
      id: 'issues',
      label: labels.issues,
      hidden: access.issues === 'hidden',
    },
    {
      id: 'remediation',
      label: labels.remediation,
      hidden: access.remediation === 'hidden',
    },
    {
      id: 'summary',
      label: labels.summary,
      hidden: access.summary === 'hidden',
    },
    { id: 'notes', label: labels.notes, hidden: access.notes === 'hidden' },
    {
      id: 'appealRequest',
      label: labels.appealRequest,
      hidden: access.appealRequest === 'hidden',
    },
    {
      id: 'appealReview',
      label: labels.appealReview,
      hidden: access.appealReview === 'hidden',
    },
    {
      id: 'amendOutcome',
      label: labels.amendOutcome,
      hidden: access.amendOutcome === 'hidden',
    },
  ];
}
