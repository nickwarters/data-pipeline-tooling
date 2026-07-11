// @ts-check
import { resolveSectionLabels } from '../../lib/section-labels.js';
import { tabEntries } from '../../lib/section-registry.js';

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
    panels: buildCaseReviewPanels(nodes),
  });
}

/**
 * Map each tab Section id to its panel node, derived from the Section registry
 * (ADR-0032) — the tab order and the id→node wiring come from one place rather
 * than a hand-maintained object literal.
 *
 * @param {import('./types.js').CaseReviewNodeRegistry} nodes
 * @returns {Record<string, Element | null>}
 */
export function buildCaseReviewPanels(nodes) {
  /** @type {Record<string, Element | null>} */
  const panels = {};
  for (const entry of tabEntries()) {
    panels[entry.id] = /** @type {Record<string, Element | null>} */ (
      /** @type {unknown} */ (nodes)
    )[entry.nodeKey];
  }
  return panels;
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
  // Tab ids and order come from the Section registry (ADR-0032); labels are
  // resolved per Case Type and hidden state from the resolved access map.
  // Every registry entry with `tab: true` has a tab-eligible id (only
  // `conversation` is excluded, and it is `tab: false`), so the id narrows to
  // CaseReviewTab['id'].
  return tabEntries().map((entry) => ({
    id: /** @type {import('./types.js').CaseReviewTab['id']} */ (entry.id),
    label: labels[entry.id],
    hidden: access[entry.id] === 'hidden',
  }));
}
