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
import '../components/cr-status-banner.js';
import '../components/cr-tabs.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
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

    // TODO(simplify-ui): Collapse this page toward a route shell that composes
    // plain function components. Ordinary tab UI should return h() nodes and
    // use reactive() only where local signals drive re-rendering.
    /** @type {((e: KeyboardEvent) => void) | null} */
    this._keydownHandler = null;
    /** @type {boolean} */
    this._eventsBound = false;
    /** @type {any} */
    this._tabsEl = null;
    /** @type {any} */
    this._detailsEl = null;
    /** @type {any} */
    this._questionsPanel = null;
    /** @type {any} */
    this._qList = null;
    /** @type {any} */
    this._progressEl = null;
    /** @type {any} */
    this._remediationSection = null;
    /** @type {any} */
    this._remediationTrackingEl = null;
    /** @type {any} */
    this._summaryEl = null;
    /** @type {any} */
    this._notesEl = null;
    /** @type {any} */
    this._appealEl = null;
    /** @type {any} */
    this._conversationEl = null;
    /** @type {any} */
    this._bannerEl = null;
    /** @type {any} */
    this._toggleBtn = null;
    /** @type {any} */
    this._headerEl = null;
    /** @type {any} */
    this._btnEl = null;
    /** @type {any} */
    this._conversationToggleBtn = null;
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
    this._keydownHandler = null;
  }

  /** @param {KeyboardEvent} e */
  _handleKeydown(e) {
    if (this._conversationPanel.keydownHandler) {
      this._conversationPanel.keydownHandler(e);
    } else if (this._keydownHandler) {
      this._keydownHandler(e);
    } else if (e.altKey && e.code === 'KeyC') {
      this._toggleConversationPanel();
    }
  }

  // Alias for tests
  _toggleConversationPanel() {
    // TODO(issue-198): Keep this as a temporary compatibility shim while the
    // real toggle behavior moves to the conversation binding.
    if (this.viewModel) {
      this.viewModel.toggleConversationPanel();
    } else if (this._conversationEl) {
      this._conversationEl.hidden = !this._conversationEl.hidden;
      if (this._toggleBtn)
        this._toggleBtn.setAttribute(
          'aria-expanded',
          String(!this._conversationEl.hidden)
        );
    }
  }

  get _activeTab() {
    return this.viewModel?.activeTab;
  }

  // Stub for tests asserting original methods
  /**
   * @param {{
   *   access: Record<string, import('../services/section-access.js').Mode>,
   *   caseRow: CaseRow,
   *   catalogue: QuestionDefinition[],
   *   computeOutcome: (answers: Record<string, Answer>) => import('../sharepoint-client.js').OutcomeResult,
   *   answersSignal?: { get: () => Record<string, Answer> },
   *   applicableQuestions?: { get: () => QuestionDefinition[] },
   *   allAnswered?: { get: () => boolean },
   *   currentUser: import('../sharepoint-client.js').CurrentUser,
   *   client?: SharePointClient,
   *   saveQueue?: SaveQueue
   * } | null | undefined} opts
   */
  _buildLayout(opts) {
    // TODO(issue-198): Replace this test-facing layout adapter with
    // user-observable controller tests from tests/cr-case-review-controllers.test.js.
    if (opts) {
      let activeTabId =
        [
          'details',
          'questions',
          'issues',
          'remediation',
          'summary',
          'notes',
          'appealRequest',
        ].find((t) => opts.access[t] !== 'hidden') || '';
      this.viewModel = /** @type {any} */ ({
        loaded: { get: () => true },
        error: { get: () => null },
        accessDenied: { get: () => false },
        caseRow: opts.caseRow,
        catalogue: opts.catalogue,
        config: {
          attributeFailures: false,
          remediationFields: [],
          computeOutcome: opts.computeOutcome,
        },
        answersSignal: { get: () => opts.answersSignal?.get() || {} },
        applicableQuestions: {
          get: () => opts.applicableQuestions?.get() || [],
        },
        allAnswered: { get: () => opts.allAnswered?.get() || false },
        currentUser: opts.currentUser,
        access: opts.access,
        roles: [],
        summarySections: [],
        machine: {
          canAttribute: false,
          canCapture: false,
          canComplete: true,
          canToggleConversation: opts.access.conversation !== 'hidden',
        },
        activeTab: {
          get: () => activeTabId,
          set: (/** @type {string} */ v) => {
            activeTabId = v;
          },
        },
        conversationHidden: { get: () => true, set: () => {} },
        handleAnswer: () => {},
        handleCapture: () => {},
        handleAttribute: () => {},
        toggleConversationPanel: () => {},
      });
    }
    const content = this.render();
    if (Array.isArray(content)) this.replaceChildren(...content);
    else if (content) this.replaceChildren(content);
  }

  /**
   * @param {string} caseId
   * @param {SharePointClient | null} [clientArg]
   * @param {SaveQueue | null} [saveQueueArg]
   * @param {Partial<CaseRow>} [patchFields]
   */
  async _completeCase(caseId, clientArg, saveQueueArg, patchFields) {
    // TODO(issue-198): Keep this temporary compatibility shim until tests call
    // completeCase() directly instead of the page private method.
    await completeCase({
      caseId,
      client: clientArg ?? this.client,
      saveQueue: saveQueueArg ?? this.saveQueue,
      patchFields: patchFields ?? null,
      opts: this.viewModel?.caseListOptions ?? {},
    });
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
    // TODO(issue-198): Decide whether conversation mode belongs in the route
    // shell or conversation binding before moving this assignment.
    this.setAttribute('data-conversation-mode', panelMode);

    /** @param {import('../services/section-access.js').Mode} m */
    const displayMode = (m) => m;

    const canToggleConversation = machine.canToggleConversation;

    this._nodeRegistry.ensure();
    this._syncLegacyNodeAliases();

    if (!this._eventsBound) {
      this._eventsBound = true;
      bindCaseReviewTabs({
        viewModel: vm,
        nodes: this._controllerNodes(canToggleConversation),
        displayMode,
        completeCase: (caseId, client, saveQueue, patchFields) =>
          this._completeCase(caseId, client, saveQueue, patchFields),
        toggleConversationPanel: this._toggleConversationPanel.bind(this),
      });

      bindQuestionPanel({
        viewModel: vm,
        nodes: this._controllerNodes(canToggleConversation),
        displayMode,
        completeCase: (caseId, client, saveQueue, patchFields) =>
          this._completeCase(caseId, client, saveQueue, patchFields),
        toggleConversationPanel: this._toggleConversationPanel.bind(this),
      });

      bindRemediationPanel({
        viewModel: vm,
        nodes: this._controllerNodes(canToggleConversation),
        displayMode,
        completeCase: (caseId, client, saveQueue, patchFields) =>
          this._completeCase(caseId, client, saveQueue, patchFields),
        toggleConversationPanel: this._toggleConversationPanel.bind(this),
      });

      bindRemediationTracking({
        viewModel: vm,
        nodes: this._controllerNodes(canToggleConversation),
        displayMode,
        completeCase: (caseId, client, saveQueue, patchFields) =>
          this._completeCase(caseId, client, saveQueue, patchFields),
        toggleConversationPanel: this._toggleConversationPanel.bind(this),
      });

      this._conversationPanel.bind({
        viewModel: vm,
        nodes: this._controllerNodes(canToggleConversation),
        displayMode,
        completeCase: (caseId, client, saveQueue, patchFields) =>
          this._completeCase(caseId, client, saveQueue, patchFields),
        toggleConversationPanel: this._toggleConversationPanel.bind(this),
      });
      this._keydownHandler = this._conversationPanel.keydownHandler;

      bindCompletion({
        viewModel: vm,
        nodes: this._controllerNodes(canToggleConversation),
        displayMode,
        completeCase: (caseId, client, saveQueue, patchFields) =>
          this._completeCase(caseId, client, saveQueue, patchFields),
        toggleConversationPanel: this._toggleConversationPanel.bind(this),
      });
    }

    updateCaseReviewTabs({
      viewModel: vm,
      nodes: this._controllerNodes(canToggleConversation),
      displayMode,
      completeCase: (caseId, client, saveQueue, patchFields) =>
        this._completeCase(caseId, client, saveQueue, patchFields),
      toggleConversationPanel: this._toggleConversationPanel.bind(this),
    });
    Object.assign(this._detailsEl, {
      caseRow,
      access: displayMode(access.details),
      detailFields: config.detailFields ?? [],
    });

    updateQuestionPanel({
      viewModel: vm,
      nodes: this._controllerNodes(canToggleConversation),
      displayMode,
      completeCase: (caseId, client, saveQueue, patchFields) =>
        this._completeCase(caseId, client, saveQueue, patchFields),
      toggleConversationPanel: this._toggleConversationPanel.bind(this),
    });

    updateRemediationPanel({
      viewModel: vm,
      nodes: this._controllerNodes(canToggleConversation),
      displayMode,
      completeCase: (caseId, client, saveQueue, patchFields) =>
        this._completeCase(caseId, client, saveQueue, patchFields),
      toggleConversationPanel: this._toggleConversationPanel.bind(this),
    });

    updateRemediationTracking({
      viewModel: vm,
      nodes: this._controllerNodes(canToggleConversation),
      displayMode,
      completeCase: (caseId, client, saveQueue, patchFields) =>
        this._completeCase(caseId, client, saveQueue, patchFields),
      toggleConversationPanel: this._toggleConversationPanel.bind(this),
    });

    updateSummaryNotesAppeal({
      viewModel: vm,
      nodes: this._controllerNodes(canToggleConversation),
      displayMode,
      completeCase: (caseId, client, saveQueue, patchFields) =>
        this._completeCase(caseId, client, saveQueue, patchFields),
      toggleConversationPanel: this._toggleConversationPanel.bind(this),
    });

    this._conversationPanel.update({
      viewModel: vm,
      nodes: this._controllerNodes(canToggleConversation),
      displayMode,
      completeCase: (caseId, client, saveQueue, patchFields) =>
        this._completeCase(caseId, client, saveQueue, patchFields),
      toggleConversationPanel: this._toggleConversationPanel.bind(this),
    });

    updateCaseReviewHeader({
      viewModel: vm,
      nodes: this._controllerNodes(canToggleConversation),
      displayMode,
      completeCase: (caseId, client, saveQueue, patchFields) =>
        this._completeCase(caseId, client, saveQueue, patchFields),
      toggleConversationPanel: this._toggleConversationPanel.bind(this),
    });

    updateCompletion({
      viewModel: vm,
      nodes: this._controllerNodes(canToggleConversation),
      displayMode,
      completeCase: (caseId, client, saveQueue, patchFields) =>
        this._completeCase(caseId, client, saveQueue, patchFields),
      toggleConversationPanel: this._toggleConversationPanel.bind(this),
    });

    // To satisfy tests that manually query _conversationToggleBtn
    this._conversationToggleBtn = canToggleConversation
      ? this._toggleBtn
      : null;

    // TODO(simplify-ui): Replace this route shell assembly with a plain
    // CaseReviewPage() function once the custom-element route boundary is
    // demoted. The shell should compose h() nodes and call binding functions
    // only for browser events that need lifecycle cleanup.
    return [
      this._bannerEl,
      this._headerEl,
      this._tabsEl,
      this._conversationEl,
      this._btnEl,
    ].filter(Boolean);
  }

  /** @param {boolean} canToggleConversation */
  _controllerNodes(canToggleConversation) {
    this._nodeRegistry.ensure();
    return {
      ...this._nodeRegistry,
      conversationToggle: canToggleConversation
        ? this._nodeRegistry.conversationToggle
        : null,
    };
  }

  _syncLegacyNodeAliases() {
    // TODO(issue-198): Remove these aliases once tests and remaining page logic
    // consume CaseReviewNodeRegistry directly.
    this._tabsEl = this._nodeRegistry.tabs;
    this._detailsEl = this._nodeRegistry.details;
    this._questionsPanel = this._nodeRegistry.questionsPanel;
    this._qList = this._nodeRegistry.questionList;
    this._progressEl = this._nodeRegistry.progress;
    this._remediationSection = this._nodeRegistry.issues;
    this._remediationTrackingEl = this._nodeRegistry.remediation;
    this._summaryEl = this._nodeRegistry.summary;
    this._notesEl = this._nodeRegistry.notes;
    this._appealEl = this._nodeRegistry.appeal;
    this._conversationEl = this._nodeRegistry.conversation;
    this._bannerEl = this._nodeRegistry.banner;
    this._toggleBtn = this._nodeRegistry.conversationToggle;
    this._headerEl = this._nodeRegistry.header;
    this._btnEl = this._nodeRegistry.completeButton;
  }
}

customElements.define('cr-case-review', CRCaseReview);
