// @ts-check
import { ShellElement } from '../lib/view.js';
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

// TODO(simplify-ui): Convert this class-backed custom element to the simpler
// function-component model. The target shape is a plain function returning h()
// nodes, wrapped in reactive() only when local signals need to re-render; keep
// custom elements only for route or browser-integration shells.
export class CRCaseReview extends ShellElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {SaveQueue | null} */
    this.saveQueue = null;
    /** @type {string} */
    this.caseId = '';
    /** @type {string | null} */
    this.caseType = null;
    /** @type {string} */
    this.currentUserId = '';
    /** @type {Capabilities | null} */
    this.capabilities = null;

    /** @type {CaseReviewViewModel | null} */
    this.viewModel = null;
    this._conversationPanel = createConversationPanelBinding();
    this._nodeRegistry = createCaseReviewNodeRegistry();

    /** @type {boolean} */
    this._eventsBound = false;
  }

  async connectedCallback() {
    if (!this.client || !this.saveQueue || !this.caseId) return;

    this.viewModel = new CaseReviewViewModel({
      client: this.client,
      saveQueue: this.saveQueue,
      caseId: this.caseId,
      currentUserId: this.currentUserId,
      capabilities: this.capabilities,
      caseType: this.caseType,
    });

    super.connectedCallback();
    await this.viewModel.load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._conversationPanel.disconnect();
  }

  render() {
    const vm = this.viewModel;
    if (!vm || !vm.loaded.get()) {
      if (vm?.error.get()) {
        return h('p', {}, vm.error.get());
      }
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

    const searchStr =
      typeof location !== 'undefined' ? (location.search ?? '') : '';
    const panelMode =
      new URLSearchParams(searchStr).get('conversation') ?? 'popover';
    // Conversation display mode (popover vs sidebar) is a route/browser-integration
    // concern: it reads a URL param and reflects it as a host attribute the CSS
    // keys off. It stays on this shell rather than the conversation binding, which
    // owns behaviour (toggle/keyboard), not the host element's presentation.
    this.setAttribute('data-conversation-mode', panelMode);

    /** @param {import('../services/section-access.js').Mode} m */
    const displayMode = (m) => m;

    const canToggleConversation = machine.canToggleConversation;

    const registry = this._nodeRegistry.ensure();
    const context = this._shellContext(vm, displayMode, canToggleConversation);

    if (!this._eventsBound) {
      this._eventsBound = true;
      bindCaseReviewTabs(context);
      bindQuestionPanel(context);
      bindRemediationPanel(context);
      bindRemediationTracking(context);
      this._conversationPanel.bind(context);
      bindCompletion(context);
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
    this._conversationPanel.update(context);
    updateCaseReviewHeader(context);
    updateCompletion(context);

    // TODO(simplify-ui): Replace this route shell assembly with a plain
    // CaseReviewPage() function once the custom-element route boundary is
    // demoted. The shell should compose h() nodes and call binding functions
    // only for browser events that need lifecycle cleanup.
    return /** @type {Node[]} */ (
      [
        registry.banner,
        registry.header,
        registry.tabs,
        registry.conversation,
        registry.completeButton,
      ].filter(Boolean)
    );
  }

  /**
   * Build the shared controller context. `conversationToggle` is only exposed
   * when the Case allows the conversation panel to be toggled; `completeCase`
   * and `toggleConversationPanel` are wired to the shared services so
   * components never reach back into the page.
   *
   * @param {CaseReviewViewModel} vm
   * @param {(m: import('../services/section-access.js').Mode) => import('../services/section-access.js').Mode} displayMode
   * @param {boolean} canToggleConversation
   * @returns {import('./cr-case-review/types.js').CaseReviewShellContext}
   */
  _shellContext(vm, displayMode, canToggleConversation) {
    const registry = this._nodeRegistry.ensure();
    return {
      viewModel: /** @type {any} */ (vm),
      nodes: {
        ...registry,
        conversationToggle: canToggleConversation
          ? registry.conversationToggle
          : null,
      },
      displayMode,
      completeCase: (caseId, client, saveQueue, patchFields) =>
        completeCase({
          caseId,
          client: client ?? this.client,
          saveQueue: saveQueue ?? this.saveQueue,
          patchFields: patchFields ?? null,
          opts: vm.caseListOptions,
        }),
      toggleConversationPanel: () => vm.toggleConversationPanel(),
    };
  }
}

customElements.define('cr-case-review', CRCaseReview);
