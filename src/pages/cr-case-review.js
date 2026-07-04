// @ts-check
import { reactive, on } from '../lib/view.js';
import { h } from '../lib/html.js';
import { CaseReviewViewModel } from '../lib/case-review-view-model.js';
import { updateCaseReviewHeader } from './cr-case-review/header-controller.js';
import {
  bindQuestionPanel,
  updateQuestionPanel,
} from './cr-case-review/question-panel-controller.js';
import { createCaseReviewNodeRegistry } from './cr-case-review/node-registry.js';
import {
  bindCaseReviewTabs,
  updateCaseReviewTabs,
} from './cr-case-review/tab-controller.js';
import {
  bindRemediationPanel,
  updateRemediationPanel,
} from './cr-case-review/remediation-controller.js';
import {
  bindRemediationTracking,
  updateRemediationTracking,
} from './cr-case-review/remediation-tracking-controller.js';
import { updateSummaryNotesAppeal } from './cr-case-review/summary-notes-appeal-controller.js';
import { updateAmendOutcome } from './cr-case-review/amend-outcome-controller.js';
import { updateAppealReview } from './cr-case-review/appeal-review-controller.js';
import { createConversationPanelBinding } from './cr-case-review/conversation-controller.js';
import {
  bindCompletion,
  completeCase,
  updateCompletion,
} from './cr-case-review/completion-controller.js';

import '../components/cr-question-list.js';
import '../components/cr-section-progress.js';
import '../components/cr-remediation-section.js';
import '../components/cr-remediation-tracking.js';
import '../components/cr-conversation.js';
import '../components/cr-notes.js';
import '../components/cr-summary.js';
import '../components/cr-appeal.js';
import '../components/cr-appeal-review.js';
import '../components/cr-amend-outcome.js';
import '../components/cr-status-banner.js';
import '../components/cr-tabs.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */
/** @typedef {import('../services/section-access.js').Mode} Mode */
/** @typedef {import('./cr-case-review/types.js').CaseReviewShellContext} CaseReviewShellContext */

/**
 * Case Review route shell (ADR-0014). A plain function component: it owns the
 * view-model, a registry of long-lived Section nodes, and the panel bindings,
 * and returns a reactive() host that re-composes `h()` nodes whenever the
 * view-model's signals change. Custom elements survive only as the leaf Section
 * components and as this route/browser-integration shell — there is no
 * class-backed page element and no per-render controller layer.
 *
 * @param {{
 *   client: SharePointClient | null,
 *   saveQueue: SaveQueue | null,
 *   caseId: string,
 *   caseType?: string | null,
 *   currentUserId?: string,
 *   capabilities?: Capabilities | null,
 * }} props
 * @returns {HTMLElement}
 */
export function CaseReviewPage({
  client,
  saveQueue,
  caseId,
  caseType = null,
  currentUserId = '',
  capabilities = null,
}) {
  // Missing collaborators — there is no Case to load, so render nothing.
  if (!client || !saveQueue || !caseId) {
    return reactive(() => []);
  }

  const viewModel = new CaseReviewViewModel({
    client,
    saveQueue,
    caseId,
    currentUserId,
    capabilities,
    caseType,
  });
  const nodeRegistry = createCaseReviewNodeRegistry();
  const conversationPanel = createConversationPanelBinding();
  let eventsBound = false;

  /**
   * Build the shared controller context. `conversationToggle` is only exposed
   * when the Case allows the conversation panel to be toggled; `completeCase`
   * is wired to the shared services so components never reach back into the
   * page.
   *
   * @param {CaseReviewViewModel} vm
   * @param {(m: Mode) => Mode} displayMode
   * @param {boolean} canToggleConversation
   * @returns {CaseReviewShellContext}
   */
  const buildContext = (vm, displayMode, canToggleConversation) => {
    const { ensure: _ensure, ...nodeFields } = nodeRegistry.ensure();
    return {
      viewModel: /** @type {any} */ (vm),
      nodes: {
        .../** @type {any} */ (nodeFields),
        conversationToggle: canToggleConversation
          ? nodeRegistry.conversationToggle
          : null,
      },
      displayMode,
      completeCase: (cid, c, sq, patchFields) =>
        completeCase({
          caseId: cid,
          client: c ?? client,
          saveQueue: sq ?? saveQueue,
          patchFields: patchFields ?? null,
          opts: vm.caseListOptions,
        }),
      toggleConversationPanel: () => vm.toggleConversationPanel(),
    };
  };

  const host = reactive(() => {
    const vm = viewModel;
    if (!vm.loaded.get()) {
      if (vm.error.get()) return h('p', {}, vm.error.get());
      return h('p', {}, 'Loading...');
    }

    if (vm.accessDenied.get()) {
      return h(
        'section',
        { class: 'cr-access-denied' },
        h('h2', {}, 'Access denied'),
        h('p', {}, 'You do not have access to this case.')
      );
    }

    const { caseRow, config, currentUser, access, machine } = vm;
    if (!caseRow || !config || !machine || !currentUser) return;

    /** @param {Mode} m */
    const displayMode = (m) => m;
    const canToggleConversation = machine.canToggleConversation;

    const registry = nodeRegistry.ensure();
    const context = buildContext(vm, displayMode, canToggleConversation);

    if (!eventsBound) {
      eventsBound = true;
      bindCaseReviewTabs(context);
      bindQuestionPanel(context);
      bindRemediationPanel(context);
      bindRemediationTracking(context);
      conversationPanel.bind(context);
      bindCompletion(context);
    }

    // Alt+C toggles the conversation panel. Registered through on() so its
    // teardown rides this reactive view's lifecycle rather than a hand-rolled
    // document add/removeEventListener pair.
    if (canToggleConversation) {
      on(document, 'keydown', (/** @type {any} */ event) =>
        conversationPanel.handleKeydown(event)
      );
    }

    updateCaseReviewTabs(context);
    Object.assign(/** @type {HTMLElement} */ (registry.details), {
      caseRow,
      access: displayMode(access.details),
      detailFields: config.detailFields ?? [],
    });
    updateQuestionPanel(context);
    updateRemediationPanel(context);
    updateRemediationTracking(context);
    updateSummaryNotesAppeal(context);
    updateAmendOutcome(context);
    updateAppealReview(context);
    conversationPanel.update(context);
    updateCaseReviewHeader(context);
    updateCompletion(context);

    return /** @type {Node[]} */ (
      [
        registry.banner,
        registry.header,
        registry.tabs,
        registry.conversation,
        registry.completeButton,
      ].filter(Boolean)
    );
  });

  // Conversation display mode (popover vs sidebar) is a route/browser-integration
  // concern: it reads a URL param once and reflects it as a host attribute the
  // CSS keys off. It stays on this shell rather than the conversation binding,
  // which owns behaviour (toggle/keyboard), not the host element's presentation.
  // The URL does not change during the view's life, so it is resolved once here.
  host.className = 'cr-case-review';
  const searchStr =
    typeof location !== 'undefined' ? (location.search ?? '') : '';
  const panelMode =
    new URLSearchParams(searchStr).get('conversation') ?? 'popover';
  host.setAttribute('data-conversation-mode', panelMode);

  viewModel.load();
  return host;
}
