// @ts-check
import { reactive, on } from '../lib/view.js';
import { h } from '../lib/html.js';
import { CaseReviewViewModel } from '../lib/case-review-view-model.js';
import { evaluate } from '../evaluators/applicability-evaluator.js';
import { tabEntries } from '../lib/section-registry.js';
import { caseDetailsView } from './cora-case-review/details-view.js';
import {
  createCaseReviewSaveEffect,
  observeSaveStatus,
} from './cora-case-review/case-actions.js';
import { createCaseReviewInterimAdapter } from './cora-case-review/interim-adapter.js';
import {
  createQuestionPanelView,
  questionGroupsOf,
} from './cora-case-review/question-panel-view.js';
import {
  conversationView,
  postConversationMessage,
  refreshConversation,
} from './cora-case-review/conversation-view.js';
import { notesView } from './cora-case-review/notes-view.js';
import { updateCaseReviewHeader } from './cora-case-review/header-controller.js';
import {
  bindQuestionPanel,
  updateQuestionPanel,
} from './cora-case-review/question-panel-controller.js';
import { createCaseReviewNodeRegistry } from './cora-case-review/node-registry.js';
import {
  bindCaseReviewTabs,
  updateCaseReviewTabs,
} from './cora-case-review/tab-controller.js';
import {
  bindRemediationPanel,
  updateRemediationPanel,
} from './cora-case-review/remediation-controller.js';
import {
  bindRemediationTracking,
  updateRemediationTracking,
} from './cora-case-review/remediation-tracking-controller.js';
import { updateSummaryNotesAppeal } from './cora-case-review/summary-notes-appeal-controller.js';
import { updateAmendOutcome } from './cora-case-review/amend-outcome-controller.js';
import { updateAppealReview } from './cora-case-review/appeal-review-controller.js';
import { createConversationPanelBinding } from './cora-case-review/conversation-controller.js';
import {
  bindCompletion,
  completeCase,
  updateCompletion,
} from './cora-case-review/completion-controller.js';

import '../components/collections/cora-question-list.js';
import '../components/base/cora-group-progress.js';
import '../components/sections/cora-remediation-section.js';
import '../components/sections/cora-remediation-tracking.js';
import '../components/sections/cora-conversation.js';
import '../components/sections/cora-notes.js';
import '../components/sections/cora-summary.js';
import '../components/sections/cora-appeal.js';
import '../components/collections/cora-appeal-review.js';
import '../components/sections/cora-amend-outcome.js';
import '../components/base/cora-status-banner.js';
import '../components/base/cora-tabs.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */
/** @typedef {import('../services/section-access.js').Mode} Mode */
/** @typedef {import('./cora-case-review/types.js').CaseReviewShellContext} CaseReviewShellContext */
/** @typedef {'saved'|'saving'|'reconnecting'|'conflict'} SaveStatus */

/**
 * @typedef {Object} CaseReviewSnapshot
 * @property {boolean} loaded
 * @property {string | null} error
 * @property {boolean} accessDenied
 * @property {import('../sharepoint-client.js').CaseRow | null} caseRow
 * @property {import('../sharepoint-client.js').CurrentUser | null} currentUser
 * @property {import('../sharepoint-client.js').CaseTypeConfig | null} config
 * @property {import('../sharepoint-client.js').QuestionDefinition[]} catalogue
 * @property {Record<string, import('../sharepoint-client.js').Answer>} answers
 * @property {import('../sharepoint-client.js').QuestionDefinition[]} applicableQuestions
 * @property {Record<import('../services/section-access.js').Section, import('../services/section-access.js').Mode>} access
 * @property {Required<import('../sharepoint-client.js').SectionLabels>} sectionLabels
 * @property {Required<import('../sharepoint-client.js').SectionLabels>} sectionHeadings
 * @property {import('../lib/case-machine.js').CaseMachine | null} machine
 * @property {import('../sharepoint-client.js').CaseListOptions} caseListOptions
 */

/**
 * @typedef {Object} CaseReviewState
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {{ caseReview: {
 *   activeTab: string,
 *   panelMode: string,
 *   saveStatus: SaveStatus,
 *   activeQuestionGroup: string,
 *   conversationHidden: boolean,
 *   snapshot: CaseReviewSnapshot | null,
 * } }} routes
 */

/**
 * @param {import('../core/chrome-state.js').ChromeState} chrome
 * @param {string} panelMode
 * @returns {CaseReviewState}
 */
export function createInitialCaseReviewState(chrome, panelMode) {
  return {
    chrome,
    routes: {
      caseReview: {
        activeTab: '',
        panelMode,
        saveStatus: 'saved',
        activeQuestionGroup: '',
        conversationHidden: true,
        snapshot: null,
      },
    },
  };
}

/** @param {CaseReviewSnapshot | null} snapshot */
function visibleCaseTabs(snapshot) {
  if (!snapshot) return [];
  return tabEntries().filter((entry) => snapshot.access[entry.id] !== 'hidden');
}

/**
 * Preserve the generic tab shell's left/right keyboard contract while the
 * selected id lives in route state.
 *
 * @param {KeyboardEvent} event
 * @param {ReturnType<typeof visibleCaseTabs>} tabs
 * @param {string} activeTab
 * @param {(action: {type: 'case/tab-selected', id: string}) => unknown} dispatch
 */
function selectAdjacentTab(event, tabs, activeTab, dispatch) {
  const step =
    event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (!step || tabs.length === 0) return;
  event.preventDefault();
  const current = Math.max(
    0,
    tabs.findIndex((entry) => entry.id === activeTab)
  );
  const next = (current + step + tabs.length) % tabs.length;
  const nextId = tabs[next].id;
  dispatch({ type: 'case/tab-selected', id: nextId });
  queueMicrotask(() => {
    const parent = /** @type {any} */ (event.target)?.parentNode;
    const button = Array.from(parent?.childNodes ?? []).find(
      (/** @type {any} */ node) =>
        node.getAttribute?.('id') === `case-tab-${nextId}`
    );
    /** @type {any} */ (button)?.focus?.();
  });
}

/**
 * @param {CaseReviewState} state
 * @param {any} action
 * @returns {CaseReviewState}
 */
export function caseReviewReducer(state, action) {
  const route = state.routes.caseReview;
  if (action.type === 'case/load-finished') {
    const tabs = visibleCaseTabs(action.snapshot);
    const groups = questionGroupsOf(action.snapshot.applicableQuestions ?? []);
    return {
      ...state,
      routes: {
        caseReview: {
          ...route,
          snapshot: action.snapshot,
          activeTab: tabs[0]?.id ?? '',
          activeQuestionGroup: groups[0] ?? '',
          conversationHidden: action.snapshot.conversationHidden ?? true,
        },
      },
    };
  }
  if (action.type === 'case/model-changed') {
    const tabs = visibleCaseTabs(action.snapshot);
    const activeTab = tabs.some((entry) => entry.id === route.activeTab)
      ? route.activeTab
      : (tabs[0]?.id ?? '');
    return {
      ...state,
      routes: {
        caseReview: { ...route, snapshot: action.snapshot, activeTab },
      },
    };
  }
  if (action.type === 'case/answers-edited' && route.snapshot) {
    const applicableIds = evaluate(route.snapshot.catalogue, action.answers);
    const applicableQuestions = route.snapshot.catalogue.filter((question) =>
      applicableIds.has(question.id)
    );
    const groups = questionGroupsOf(applicableQuestions);
    const snapshot = {
      ...route.snapshot,
      answers: action.answers,
      applicableQuestions,
      caseRow: route.snapshot.caseRow
        ? { ...route.snapshot.caseRow, answers: action.answers }
        : null,
    };
    return {
      ...state,
      routes: {
        caseReview: {
          ...route,
          snapshot,
          activeQuestionGroup: groups.includes(route.activeQuestionGroup)
            ? route.activeQuestionGroup
            : (groups[0] ?? ''),
        },
      },
    };
  }
  if (action.type === 'case/tab-selected') {
    const visible = visibleCaseTabs(route.snapshot).some(
      (entry) => entry.id === action.id
    );
    if (!visible || action.id === route.activeTab) return state;
    return {
      ...state,
      routes: { caseReview: { ...route, activeTab: action.id } },
    };
  }
  if (action.type === 'case/question-group-selected') {
    const groups = questionGroupsOf(route.snapshot?.applicableQuestions ?? []);
    if (
      !groups.includes(action.group) ||
      action.group === route.activeQuestionGroup
    ) {
      return state;
    }
    return {
      ...state,
      routes: {
        caseReview: { ...route, activeQuestionGroup: action.group },
      },
    };
  }
  if (action.type === 'case/conversation-toggled') {
    if (route.snapshot?.access.conversation === 'hidden') return state;
    return {
      ...state,
      routes: {
        caseReview: {
          ...route,
          conversationHidden: !route.conversationHidden,
        },
      },
    };
  }
  if (action.type === 'case/conversation-changed' && route.snapshot?.caseRow) {
    const caseRow = {
      ...route.snapshot.caseRow,
      conversation: action.messages,
    };
    return {
      ...state,
      routes: {
        caseReview: {
          ...route,
          snapshot: { ...route.snapshot, caseRow },
        },
      },
    };
  }
  if (action.type === 'case/field-edited' && route.snapshot?.caseRow) {
    const caseRow = {
      ...route.snapshot.caseRow,
      [action.field]: action.value,
    };
    return {
      ...state,
      routes: {
        caseReview: {
          ...route,
          snapshot: { ...route.snapshot, caseRow },
        },
      },
    };
  }
  if (action.type === 'case/save-status-changed') {
    if (action.status === route.saveStatus) return state;
    return {
      ...state,
      routes: { caseReview: { ...route, saveStatus: action.status } },
    };
  }
  return state;
}

/**
 * @param {SaveStatus} status
 * @returns {HTMLElement | null}
 */
function saveStatusView(status) {
  if (status === 'saved') return null;
  if (status === 'conflict') {
    return h(
      'div',
      {
        className: 'cora-banner cora-banner-conflict',
        role: 'alert',
        'aria-live': 'assertive',
      },
      h(
        'p',
        { className: 'cora-banner-text' },
        'This Case was edited in another tab. Reload to continue.'
      ),
      h(
        'button',
        {
          className: 'cora-banner-reload',
          onClick: () => location.reload(),
        },
        'Reload'
      )
    );
  }
  return h(
    'div',
    {
      className: `cora-banner cora-banner-${status}`,
      role: 'status',
      'aria-live': 'polite',
    },
    status === 'saving' ? 'Saving…' : 'Reconnecting…'
  );
}

/**
 * CASE-1 route slice. The view model adapts existing loading/domain behaviour
 * into store snapshots; the interim adapter owns only the unconverted Section
 * components.
 *
 * @param {Record<string, string>} params
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function createRouteSlice(params, context) {
  const search = typeof location === 'undefined' ? '' : (location.search ?? '');
  const panelMode =
    new URLSearchParams(search).get('conversation') ?? 'popover';
  let dispatch = (/** @type {any} */ _action) => {};
  const viewModel = new CaseReviewViewModel({
    client: context.client,
    saveQueue: context.saveQueue,
    caseId: params.id,
    caseType: params.caseType ?? null,
    currentUserId:
      context.chrome.currentUser?.id ?? context.currentUser?.id ?? '',
    capabilities: context.chrome.permissions ?? context.capabilities,
  });
  const adapter = createCaseReviewInterimAdapter({
    viewModel,
    client: context.client,
    saveQueue: context.saveQueue,
    modelChanged() {
      dispatch({
        type: 'case/model-changed',
        snapshot: viewModel.toStoreSnapshot(),
      });
    },
  });
  const questionsView = createQuestionPanelView();
  /** @type {null | {
   *   root: HTMLElement,
   *   status: HTMLElement,
   *   header: HTMLElement,
   *   tablist: HTMLElement,
   *   panels: Record<string, HTMLElement>,
   *   conversation: HTMLElement,
   *   completion: HTMLElement,
   * }} */
  let shell = null;

  /** @param {Element} container @param {any} tools */
  function ensureShell(container, tools) {
    if (shell) return shell;
    const status = h('div', { className: 'cora-case-review__save-status' });
    // Preserve the retired status-banner host placement until its styles move
    // to the store shell's stylesheet in a dedicated styling change.
    Object.assign(status.style, {
      position: 'fixed',
      bottom: 'var(--cora-space-4)',
      right: 'var(--cora-space-4)',
      zIndex: '110',
    });
    const header = h('header');
    const tablist = h('div', {
      role: 'tablist',
      className: 'cora-tabs-list',
    });
    /** @type {Record<string, HTMLElement>} */
    const panels = {};
    for (const entry of tabEntries()) {
      panels[entry.id] = h('div', {
        className: 'cora-tabs-panel',
        role: 'tabpanel',
        id: `case-panel-${entry.id}`,
        'aria-labelledby': `case-tab-${entry.id}`,
        tabindex: '0',
        hidden: true,
      });
    }
    const conversation = h('div', {
      className: 'cora-case-review__conversation',
    });
    const completion = h('div', {
      className: 'cora-case-review__completion',
    });
    const root = h(
      'div',
      {
        className: 'cora-case-review',
        'data-conversation-mode': panelMode,
      },
      status,
      header,
      h('div', { className: 'cora-tabs' }, tablist, ...Object.values(panels)),
      conversation,
      completion
    );
    tools.morph(container, root);
    shell = { root, status, header, tablist, panels, conversation, completion };
    return shell;
  }

  /** @param {CaseReviewState} state @param {any} tools @param {Element} container */
  function renderRoute(state, tools, container) {
    const parts = ensureShell(container, tools);
    const route = state.routes.caseReview;
    const snapshot = route.snapshot;
    tools.morph(parts.status, saveStatusView(route.saveStatus));

    if (!snapshot) {
      tools.morph(parts.header, h('p', {}, 'Loading...'));
      return;
    }
    if (snapshot.error) {
      tools.morph(parts.header, h('p', {}, snapshot.error));
      return;
    }
    if (snapshot.accessDenied) {
      tools.morph(
        parts.header,
        h(
          'section',
          { className: 'cora-access-denied' },
          h('h2', {}, 'Access denied'),
          h('p', {}, 'You do not have access to this case.')
        )
      );
      return;
    }
    if (
      !snapshot.loaded ||
      !snapshot.caseRow ||
      !snapshot.config ||
      !snapshot.currentUser
    ) {
      return;
    }
    const currentUser = snapshot.currentUser;

    adapter.update();
    tools.morph(parts.header, [
      h('h1', {}, snapshot.caseRow.title),
      h('p', {}, `Reviewer: ${snapshot.caseRow.assignedReviewer}`),
      snapshot.machine?.canToggleConversation
        ? h(
            'button',
            {
              className: 'cora-conversation-toggle-btn',
              'aria-expanded': String(!route.conversationHidden),
              'aria-label': 'Toggle conversation panel (⌥C / Alt+C)',
              onClick: () =>
                tools.dispatch({ type: 'case/conversation-toggled' }),
            },
            snapshot.sectionHeadings.conversation
          )
        : null,
    ]);

    const tabs = visibleCaseTabs(snapshot);
    tools.morph(
      parts.tablist,
      tabs.map((entry) => {
        const selected = route.activeTab === entry.id;
        return h(
          'button',
          {
            key: `tab-${entry.id}`,
            className: 'cora-tabs-tab',
            role: 'tab',
            id: `case-tab-${entry.id}`,
            'aria-controls': `case-panel-${entry.id}`,
            'aria-selected': String(selected),
            tabindex: selected ? '0' : '-1',
            onClick: () =>
              tools.dispatch({ type: 'case/tab-selected', id: entry.id }),
            onKeyDown: (/** @type {KeyboardEvent} */ event) =>
              selectAdjacentTab(event, tabs, route.activeTab, tools.dispatch),
          },
          snapshot.sectionLabels[entry.id]
        );
      })
    );

    const legacyPanels = adapter.panels;
    for (const entry of tabEntries()) {
      const panel = parts.panels[entry.id];
      const visible = snapshot.access[entry.id] !== 'hidden';
      panel.hidden = !visible || route.activeTab !== entry.id;
      if (entry.id === 'details') {
        tools.morph(
          panel,
          visible
            ? caseDetailsView(
                snapshot.caseRow,
                snapshot.config.detailFields ?? []
              )
            : null
        );
        continue;
      }
      if (entry.id === 'questions') {
        tools.morph(
          panel,
          visible
            ? questionsView.render({
                catalogue: snapshot.catalogue,
                questions: snapshot.applicableQuestions,
                answers: snapshot.answers,
                activeGroup: route.activeQuestionGroup,
                access: snapshot.access.questions,
                heading: snapshot.sectionHeadings.questions,
                outcomeOptions: snapshot.config.outcomeOptions ?? [],
                onAnswer: (questionId, value) =>
                  viewModel.handleAnswer(questionId, value),
                onGroupSelected: (group) =>
                  tools.dispatch({
                    type: 'case/question-group-selected',
                    group,
                  }),
              })
            : null
        );
        continue;
      }
      if (entry.id === 'notes') {
        tools.morph(
          panel,
          visible
            ? notesView({
                notes: snapshot.caseRow.notes,
                caseJustification: snapshot.caseRow.caseJustification ?? '',
                access: snapshot.access.notes,
                heading: snapshot.sectionHeadings.notes,
                placeholders: snapshot.config.placeholders ?? {},
                onFieldInput: (field, value) => {
                  tools.dispatch({
                    type: 'case/field-edited',
                    field,
                    value,
                  });
                  context.saveQueue.enqueue(params.id, field, value);
                },
              })
            : null
        );
        continue;
      }
      const node = legacyPanels[entry.id];
      if (!node) continue;
      if (visible && node.parentNode !== panel) panel.appendChild(node);
      if (!visible && node.parentNode === panel) panel.removeChild(node);
    }

    parts.conversation.hidden =
      snapshot.access.conversation === 'hidden' || route.conversationHidden;
    tools.morph(
      parts.conversation,
      snapshot.access.conversation === 'hidden'
        ? null
        : conversationView({
            messages: snapshot.caseRow.conversation,
            access: snapshot.access.conversation,
            heading: snapshot.sectionHeadings.conversation,
            onSend: async (body) => {
              await postConversationMessage({
                client: context.client,
                saveQueue: context.saveQueue,
                caseId: params.id,
                messages: snapshot.caseRow?.conversation ?? [],
                currentUser,
                caseListOptions: snapshot.caseListOptions,
                body,
                onMessages: (messages) =>
                  tools.dispatch({
                    type: 'case/conversation-changed',
                    messages,
                  }),
              });
            },
          })
    );
    const completeButton = adapter.completeButton;
    if (completeButton && completeButton.parentNode !== parts.completion) {
      parts.completion.appendChild(completeButton);
    }
  }

  return {
    initialState: createInitialCaseReviewState(context.chrome, panelMode),
    reducer: caseReviewReducer,
    render(
      /** @type {Element} */ container,
      /** @type {CaseReviewState} */ state,
      /** @type {any} */ tools
    ) {
      renderRoute(state, tools, container);
    },
    start(/** @type {any} */ tools) {
      dispatch = tools.dispatch;
      const save = createCaseReviewSaveEffect({
        saveQueue: context.saveQueue,
        caseId: params.id,
        dispatch: tools.dispatch,
      });
      viewModel.setAnswerChangeHandler((answers) =>
        save.answersEdited(answers)
      );
      const disposeSaveStatus = observeSaveStatus(
        context.saveQueue,
        tools.dispatch
      );
      if (typeof document !== 'undefined') {
        tools.listen(
          document,
          'keydown',
          (/** @type {KeyboardEvent} */ event) => {
            if (event.altKey && event.code === 'KeyC') {
              tools.dispatch({ type: 'case/conversation-toggled' });
            }
          }
        );
        tools.listen(document, 'visibilitychange', () => {
          if (document.hidden) return;
          void refreshConversation({
            client: context.client,
            caseId: params.id,
            caseListOptions: viewModel.caseListOptions,
          }).then((row) => {
            if (row) {
              tools.dispatch({
                type: 'case/conversation-changed',
                messages: row.conversation,
              });
            }
          });
        });
      }
      void viewModel.load().then(() => {
        tools.dispatch({
          type: 'case/load-finished',
          snapshot: viewModel.toStoreSnapshot(),
        });
      });
      return () => {
        questionsView.clear();
        viewModel.setAnswerChangeHandler(null);
        disposeSaveStatus();
      };
    },
  };
}

/**
 * Legacy Case Review rollback/compatibility shell. The store route no longer
 * mounts this function, but CASE-1 deliberately retains it while the remaining
 * Sections migrate in CASE-2 through CASE-6. Do not extend this path; its tests
 * pin rollback compatibility until the final Section migration removes it.
 *
 * A plain function component: it owns the
 * view-model, a registry of long-lived Section nodes, and the panel bindings,
 * and returns a reactive() host that re-composes `h()` nodes whenever the
 * view-model's signals change. Custom elements survive only as the leaf Section
 * components and as this route/browser-integration shell — there is no
 * class-backed page element and no per-render controller layer.
 *
 * @param {{
 * client: SharePointClient | null,
 * saveQueue: SaveQueue | null,
 * caseId: string,
 * caseType?: string | null,
 * currentUserId?: string,
 * capabilities?: Capabilities | null,
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
        { class: 'cora-access-denied' },
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
  host.className = 'cora-case-review';
  const searchStr =
    typeof location !== 'undefined' ? (location.search ?? '') : '';
  const panelMode =
    new URLSearchParams(searchStr).get('conversation') ?? 'popover';
  host.setAttribute('data-conversation-mode', panelMode);

  viewModel.load();
  return host;
}
