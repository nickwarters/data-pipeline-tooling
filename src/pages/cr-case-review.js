// @ts-check
import { ReactiveElement } from '../components/reactive-element.js';
import { h } from '../lib/html.js';
import { CaseReviewViewModel } from '../lib/case-review-view-model.js';
import { CaseReviewHeaderController } from './cr-case-review/header-controller.js';
import { QuestionPanelController } from './cr-case-review/question-panel-controller.js';
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
    this._questionPanelController = new QuestionPanelController();
    this._completionController = new CompletionController();

    // TODO(issue-198): Move controller-owned lifecycle state into
    // cr-case-review/conversation-controller.js and
    // cr-case-review/node-registry.js as the page becomes a route shell.
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
    // TODO(issue-198): Delegate teardown to controller disconnect methods,
    // starting with ConversationPanelController for document-level shortcuts.
    if (this._keydownHandler && typeof document !== 'undefined') {
      document.removeEventListener('keydown', this._keydownHandler);
      this._keydownHandler = null;
    }
  }

  /** @param {KeyboardEvent} e */
  _handleKeydown(e) {
    // TODO(issue-198): Move keyboard shortcut handling to
    // cr-case-review/conversation-controller.js.
    if (this._keydownHandler) {
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

    const {
      caseRow,
      catalogue,
      config,
      answersSignal,
      allAnswered,
      currentUser,
      access,
      roles,
      summarySections,
      sourceCase,
      machine,
    } = vm;

    if (!caseRow || !config || !machine || !currentUser) return;

    const answers = answersSignal.get();
    const isAllAnswered = allAnswered.get();

    const searchStr =
      typeof location !== 'undefined' ? (location.search ?? '') : '';
    const panelMode =
      new URLSearchParams(searchStr).get('conversation') ?? 'popover';
    // TODO(issue-198): Decide whether conversation mode belongs in the route
    // shell or ConversationPanelController before moving this assignment.
    this.setAttribute('data-conversation-mode', panelMode);

    /** @param {import('../services/section-access.js').Mode} m */
    const displayMode = (m) => (m === 'override' ? 'read-only' : m);

    // TODO(issue-198): Move tab descriptor construction to
    // cr-case-review/tab-controller.js buildCaseReviewTabs().
    const tabs = [
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

    const canAttribute = machine.canAttribute;
    const canCapture = machine.canCapture;
    const canToggleConversation = machine.canToggleConversation;

    // TODO(issue-198): Move conversation shortcut binding to
    // ConversationPanelController.bind()/disconnect().
    if (canToggleConversation && !this._keydownHandler) {
      this._keydownHandler = (e) => {
        if (e.altKey && e.code === 'KeyC') {
          this._toggleConversationPanel();
        }
      };
      if (typeof document !== 'undefined')
        document.addEventListener('keydown', this._keydownHandler);
    } else if (!canToggleConversation && this._keydownHandler) {
      if (typeof document !== 'undefined')
        document.removeEventListener('keydown', this._keydownHandler);
      this._keydownHandler = null;
    }

    // TODO(issue-198): Move node creation/reuse to
    // cr-case-review/node-registry.js and update tests away from private caches.
    // Node reuse to satisfy tests that cache elements
    this._tabsEl ??= /** @type {any} */ (h('cr-tabs'));
    this._detailsEl ??= /** @type {any} */ (h('cr-case-details'));
    this._questionsPanel ??= /** @type {any} */ (h('section'));
    this._qList ??= /** @type {any} */ (h('cr-question-list'));
    this._progressEl ??= /** @type {any} */ (h('cr-section-progress'));
    this._overrideEditor ??= /** @type {any} */ (h('cr-override-editor'));
    this._remediationSection ??= /** @type {any} */ (
      h('cr-remediation-section')
    );
    this._summaryEl ??= /** @type {any} */ (h('cr-summary'));
    this._notesEl ??= /** @type {any} */ (h('cr-notes'));
    this._appealEl ??= /** @type {any} */ (h('cr-appeal'));
    this._conversationEl ??= /** @type {any} */ (h('cr-conversation'));
    this._sourceCaseEl ??= /** @type {any} */ (h('cr-source-case'));
    this._bannerEl ??= /** @type {any} */ (h('cr-status-banner'));
    this._toggleBtn ??= /** @type {any} */ (
      h('button', { class: 'cr-conversation-toggle-btn' })
    );
    this._headerEl ??= /** @type {any} */ (h('header'));
    this._btnEl ??= /** @type {any} */ (
      h('button', { class: 'cr-complete-btn' })
    );

    if (!this._eventsBound) {
      this._eventsBound = true;
      // TODO(issue-198): Move tab event wiring to
      // CaseReviewTabController.bind().
      this._tabsEl.addEventListener(
        'cr-tab-change',
        (/** @type {CustomEvent} */ ev) =>
          vm.activeTab.set(/** @type {any} */ (ev).detail.id)
      );

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

      // TODO(issue-198): Move Issues-tab capture/attribute wiring to
      // RemediationPanelController.bind().
      this._remediationSection.addEventListener(
        'cr-capture',
        (/** @type {CustomEvent} */ ev) =>
          vm.handleCapture(
            /** @type {any} */ (ev).detail.questionId,
            /** @type {any} */ (ev).detail.fieldKey,
            /** @type {any} */ (ev).detail.value
          )
      );
      this._remediationSection.addEventListener(
        'cr-attribute',
        (/** @type {CustomEvent} */ ev) =>
          vm.handleAttribute(
            /** @type {any} */ (ev).detail.questionId,
            /** @type {any} */ (ev).detail.attributedParty
          )
      );

      this._toggleBtn.addEventListener('click', () =>
        this._toggleConversationPanel()
      );

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

    // TODO(issue-198): Move tab property/panel assignment to
    // CaseReviewTabController.update().
    Object.assign(this._tabsEl, { tabs, selected: vm.activeTab.get() });
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

    // TODO(issue-198): Move Issues-tab property assignment and update calls to
    // RemediationPanelController.update().
    Object.assign(this._remediationSection, {
      client: vm.client,
      canAttribute,
      responsibleParty: caseRow.responsibleParty
        ? {
            loginName: caseRow.responsibleParty,
            displayName: caseRow.responsibleParty,
          }
        : null,
      captureGroups: config.captureGroups ?? [],
      canCapture,
      catalogue,
      answers,
      attributeFailures: config.attributeFailures === true,
    });
    if (this._remediationSection.update)
      this._remediationSection.update(
        catalogue,
        answers,
        config.attributeFailures === true
      );

    // TODO(issue-198): Move Summary, Notes, and Appeal property assignment to
    // SummaryNotesAppealController.update().
    Object.assign(this._summaryEl, {
      caseRow,
      catalogue,
      summarySections,
      captureGroups: config.captureGroups ?? [],
    });
    if (this._summaryEl.update)
      this._summaryEl.update(config.computeOutcome, answers, isAllAnswered);

    Object.assign(this._notesEl, {
      notes: caseRow.notes,
      caseJustification: caseRow.caseJustification ?? '',
      saveQueue: vm.saveQueue,
      caseId: caseRow.id,
      access: displayMode(access.notes),
    });

    Object.assign(this._appealEl, {
      caseRow,
      saveQueue: vm.saveQueue,
      caseId: caseRow.id,
      access: displayMode(access.appeal),
      canResolve: roles.includes('qaReviewer'),
      attributeFailures: config.attributeFailures === true,
      remediationFields: config.remediationFields ?? [],
      computeOutcome: config.computeOutcome,
      client: vm.client,
      currentUser,
      catalogue,
      answers: caseRow.answers,
    });

    this._tabsEl.panels = {
      details: this._detailsEl,
      questions: this._questionsPanel,
      remediation: this._remediationSection,
      summary: this._summaryEl,
      notes: this._notesEl,
      appeal: this._appealEl,
    };

    // TODO(issue-198): Move conversation element assignment and toggle aria
    // updates to ConversationPanelController.update().
    Object.assign(this._conversationEl, {
      client: vm.client,
      saveQueue: vm.saveQueue,
      caseId: caseRow.id,
      currentUser,
      access: displayMode(access.conversation),
      hidden: vm.conversationHidden.get(),
      _messages: caseRow.conversation.slice(),
    });

    if (canToggleConversation) {
      this._toggleBtn.setAttribute(
        'aria-expanded',
        String(!vm.conversationHidden.get())
      );
      this._toggleBtn.setAttribute(
        'aria-label',
        'Toggle conversation panel (⌥C / Alt+C)'
      );
      this._toggleBtn.textContent = 'Conversation';
    }

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

    // TODO(issue-198): Move QA Check source-case assignment to
    // SourceCaseController.update().
    if (sourceCase) {
      Object.assign(this._sourceCaseEl, {
        originalRow: sourceCase.originalRow,
        catalogue: sourceCase.catalogue,
        computeOutcome: sourceCase.computeOutcome,
        attributeFailures: sourceCase.attributeFailures,
        remediationFields: sourceCase.remediationFields,
        saveQueue: vm.saveQueue,
        currentUser: vm.currentUser,
        client: vm.client,
        overrideAccess: sourceCase.overrideAccess,
        sourceCaseId: sourceCase.sourceCaseId,
      });
    }

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
    return {
      tabs: this._tabsEl,
      details: this._detailsEl,
      questionsPanel: this._questionsPanel,
      questionList: this._qList,
      progress: this._progressEl,
      overrideEditor: this._overrideEditor,
      remediation: this._remediationSection,
      summary: this._summaryEl,
      notes: this._notesEl,
      appeal: this._appealEl,
      conversation: this._conversationEl,
      sourceCase: this._sourceCaseEl,
      banner: this._bannerEl,
      conversationToggle: canToggleConversation ? this._toggleBtn : null,
      header: this._headerEl,
      completeButton: this._btnEl,
    };
  }
}

customElements.define('cr-case-review', CRCaseReview);
