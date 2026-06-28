// @ts-check
import { ReactiveElement } from '../components/reactive-element.js';
import { h } from '../lib/html.js';
import { CaseReviewViewModel } from '../lib/case-review-view-model.js';
import { CaseReviewHeaderController } from './cr-case-review/header-controller.js';
import { QuestionPanelController } from './cr-case-review/question-panel-controller.js';
import { createCaseReviewNodeRegistry } from './cr-case-review/node-registry.js';
import { CaseReviewTabController } from './cr-case-review/tab-controller.js';
import { RemediationPanelController } from './cr-case-review/remediation-controller.js';
import { SummaryNotesAppealController } from './cr-case-review/summary-notes-appeal-controller.js';
import { SourceCaseController } from './cr-case-review/source-case-controller.js';
import { ConversationPanelController } from './cr-case-review/conversation-controller.js';
import {
  CompletionController,
  completeCase,
} from './cr-case-review/completion-controller.js';

import '../components/cr-question-list.js';
import '../components/cr-section-progress.js';
import '../components/cr-remediation-section.js';
import '../components/cr-conversation.js';
import '../components/cr-notes.js';
import '../components/cr-summary.js';
import '../components/cr-appeal.js';
import '../components/cr-override-editor.js';
import '../components/cr-source-case.js';
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
export class CRCaseReview extends ReactiveElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {SaveQueue | null} */
    this.saveQueue = null;
    /** @type {string} */
    this.caseId = '';
    /** @type {string} */
    this.currentUserId = '';
    /** @type {Capabilities | null} */
    this.capabilities = null;

    /** @type {CaseReviewViewModel | null} */
    this.viewModel = null;
    this._headerController = new CaseReviewHeaderController();
    this._tabController = new CaseReviewTabController();
    this._questionPanelController = new QuestionPanelController();
    this._remediationPanelController = new RemediationPanelController();
    this._summaryNotesAppealController = new SummaryNotesAppealController();
    this._sourceCaseController = new SourceCaseController();
    this._conversationPanelController = new ConversationPanelController();
    this._completionController = new CompletionController();
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
    this._overrideEditor = null;
    /** @type {any} */
    this._remediationSection = null;
    /** @type {any} */
    this._summaryEl = null;
    /** @type {any} */
    this._notesEl = null;
    /** @type {any} */
    this._appealEl = null;
    /** @type {any} */
    this._conversationEl = null;
    /** @type {any} */
    this._sourceCaseEl = null;
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

    this.viewModel = new CaseReviewViewModel(
      this.client,
      this.saveQueue,
      this.caseId,
      this.currentUserId,
      this.capabilities
    );

    super.connectedCallback();
    await this.viewModel.load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._conversationPanelController.disconnect();
    this._keydownHandler = null;
  }

  /** @param {KeyboardEvent} e */
  _handleKeydown(e) {
    if (this._conversationPanelController.keydownHandler) {
      this._conversationPanelController.keydownHandler(e);
    } else if (this._keydownHandler) {
      this._keydownHandler(e);
    } else if (e.altKey && e.code === 'KeyC') {
      this._toggleConversationPanel();
    }
  }

  // Alias for tests
  _toggleConversationPanel() {
    // TODO(issue-198): Keep this as a temporary compatibility shim while the
    // real toggle behavior moves to ConversationPanelController.
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
          'remediation',
          'summary',
          'notes',
          'appeal',
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
        sourceCase: null,
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

    const { caseRow, config, currentUser, access, sourceCase, machine } = vm;

    if (!caseRow || !config || !machine || !currentUser) return;

    const searchStr =
      typeof location !== 'undefined' ? (location.search ?? '') : '';
    const panelMode =
      new URLSearchParams(searchStr).get('conversation') ?? 'popover';
    // TODO(issue-198): Decide whether conversation mode belongs in the route
    // shell or ConversationPanelController before moving this assignment.
    this.setAttribute('data-conversation-mode', panelMode);

    /** @param {import('../services/section-access.js').Mode} m */
    const displayMode = (m) => (m === 'override' ? 'read-only' : m);

    const canToggleConversation = machine.canToggleConversation;

    this._nodeRegistry.ensure();
    this._syncLegacyNodeAliases();

    if (!this._eventsBound) {
      this._eventsBound = true;
      this._tabController.bind({
        viewModel: vm,
        nodes: this._controllerNodes(canToggleConversation),
        displayMode,
        completeCase: (caseId, client, saveQueue, patchFields) =>
          this._completeCase(caseId, client, saveQueue, patchFields),
        toggleConversationPanel: this._toggleConversationPanel.bind(this),
      });

      // TODO(issue-198): QuestionPanelController owns Review-tab event wiring;
      // keep this context adapter until the shared node registry is wired.
      this._questionPanelController.bind({
        viewModel: vm,
        nodes: this._controllerNodes(canToggleConversation),
        displayMode,
        completeCase: (caseId, client, saveQueue, patchFields) =>
          this._completeCase(caseId, client, saveQueue, patchFields),
        toggleConversationPanel: this._toggleConversationPanel.bind(this),
      });

      this._remediationPanelController.bind({
        viewModel: vm,
        nodes: this._controllerNodes(canToggleConversation),
        displayMode,
        completeCase: (caseId, client, saveQueue, patchFields) =>
          this._completeCase(caseId, client, saveQueue, patchFields),
        toggleConversationPanel: this._toggleConversationPanel.bind(this),
      });

      this._conversationPanelController.bind({
        viewModel: vm,
        nodes: this._controllerNodes(canToggleConversation),
        displayMode,
        completeCase: (caseId, client, saveQueue, patchFields) =>
          this._completeCase(caseId, client, saveQueue, patchFields),
        toggleConversationPanel: this._toggleConversationPanel.bind(this),
      });
      this._keydownHandler = this._conversationPanelController.keydownHandler;

      // TODO(issue-198): CompletionController owns completion event wiring; keep
      // this context adapter until the shared node registry is wired.
      this._completionController.bind({
        viewModel: vm,
        nodes: this._controllerNodes(canToggleConversation),
        displayMode,
        completeCase: (caseId, client, saveQueue, patchFields) =>
          this._completeCase(caseId, client, saveQueue, patchFields),
        toggleConversationPanel: this._toggleConversationPanel.bind(this),
      });
    }

    this._tabController.update({
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
    });

    // TODO(issue-198): QuestionPanelController owns Review-tab assignment;
    // keep this context adapter until the shared node registry is wired.
    this._questionPanelController.update({
      viewModel: vm,
      nodes: this._controllerNodes(canToggleConversation),
      displayMode,
      completeCase: (caseId, client, saveQueue, patchFields) =>
        this._completeCase(caseId, client, saveQueue, patchFields),
      toggleConversationPanel: this._toggleConversationPanel.bind(this),
    });

    this._remediationPanelController.update({
      viewModel: vm,
      nodes: this._controllerNodes(canToggleConversation),
      displayMode,
      completeCase: (caseId, client, saveQueue, patchFields) =>
        this._completeCase(caseId, client, saveQueue, patchFields),
      toggleConversationPanel: this._toggleConversationPanel.bind(this),
    });

    this._summaryNotesAppealController.update({
      viewModel: vm,
      nodes: this._controllerNodes(canToggleConversation),
      displayMode,
      completeCase: (caseId, client, saveQueue, patchFields) =>
        this._completeCase(caseId, client, saveQueue, patchFields),
      toggleConversationPanel: this._toggleConversationPanel.bind(this),
    });

    this._conversationPanelController.update({
      viewModel: vm,
      nodes: this._controllerNodes(canToggleConversation),
      displayMode,
      completeCase: (caseId, client, saveQueue, patchFields) =>
        this._completeCase(caseId, client, saveQueue, patchFields),
      toggleConversationPanel: this._toggleConversationPanel.bind(this),
    });

    // TODO(issue-198): Header and banner assignment now lives in
    // CaseReviewHeaderController; keep this context adapter until node registry
    // and remaining controllers are wired.
    this._headerController.update({
      viewModel: vm,
      nodes: this._controllerNodes(canToggleConversation),
      displayMode,
      completeCase: (caseId, client, saveQueue, patchFields) =>
        this._completeCase(caseId, client, saveQueue, patchFields),
      toggleConversationPanel: this._toggleConversationPanel.bind(this),
    });

    this._sourceCaseController.update({
      viewModel: vm,
      nodes: this._controllerNodes(canToggleConversation),
      displayMode,
      completeCase: (caseId, client, saveQueue, patchFields) =>
        this._completeCase(caseId, client, saveQueue, patchFields),
      toggleConversationPanel: this._toggleConversationPanel.bind(this),
    });

    // TODO(issue-198): CompletionController owns complete button state; keep
    // this context adapter until the shared node registry is wired.
    this._completionController.update({
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

    // TODO(issue-198): Keep final route shell assembly here after controllers
    // own their nodes, events, and property assignment.
    return [
      this._bannerEl,
      this._headerEl,
      sourceCase ? this._sourceCaseEl : null,
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
    this._overrideEditor = this._nodeRegistry.overrideEditor;
    this._remediationSection = this._nodeRegistry.remediation;
    this._summaryEl = this._nodeRegistry.summary;
    this._notesEl = this._nodeRegistry.notes;
    this._appealEl = this._nodeRegistry.appeal;
    this._conversationEl = this._nodeRegistry.conversation;
    this._sourceCaseEl = this._nodeRegistry.sourceCase;
    this._bannerEl = this._nodeRegistry.banner;
    this._toggleBtn = this._nodeRegistry.conversationToggle;
    this._headerEl = this._nodeRegistry.header;
    this._btnEl = this._nodeRegistry.completeButton;
  }
}

customElements.define('cr-case-review', CRCaseReview);
