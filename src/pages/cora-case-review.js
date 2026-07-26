// @ts-check
import { h } from '../lib/html.js';
import { CaseReviewViewModel } from '../lib/case-review-view-model.js';
import { CASE_STATUS } from '../lib/case-statuses.js';
import {
  allApplicableAnswered,
  evaluate,
} from '../evaluators/applicability-evaluator.js';
import { tabEntries } from '../lib/section-registry.js';
import {
  createCaseReviewSaveEffect,
  observeSaveStatus,
} from './cora-case-review/case-actions.js';
import { createQuestionPanelView } from './cora-case-review/question-panel-view.js';
import {
  conversationView,
  postConversationMessage,
  refreshConversation,
} from './cora-case-review/conversation-view.js';
import { createAppealEffects } from './cora-case-review/appeal-effects.js';
import {
  answerEdited,
  failureAttributed,
} from './cora-case-review/answer-actions.js';
import { SECTION_PANELS } from './cora-case-review/section-panels.js';
import {
  completeCase,
  completionControl,
  completionPatch,
} from './cora-case-review/completion-actions.js';

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
 * @property {boolean} allAnswered
 * @property {import('../services/section-access.js').Section[]} summarySections
 * @property {string | null} exportHash
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
 *   conversationHidden: boolean,
 *   completionPending: boolean,
 *   captureCollapsed: Record<string, Map<string, boolean>>,
 *   attributionSearch: Record<string, { query: string, people: import('../sharepoint-client.js').PersonResult[] }>,
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
        conversationHidden: true,
        completionPending: false,
        captureCollapsed: {},
        attributionSearch: {},
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
    return {
      ...state,
      routes: {
        caseReview: {
          ...route,
          snapshot: action.snapshot,
          activeTab: tabs[0]?.id ?? '',
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
    const snapshot = {
      ...route.snapshot,
      answers: action.answers,
      applicableQuestions,
      allAnswered: allApplicableAnswered(
        route.snapshot.catalogue,
        action.answers
      ),
      caseRow: route.snapshot.caseRow
        ? { ...route.snapshot.caseRow, answers: action.answers }
        : null,
    };
    return {
      ...state,
      routes: { caseReview: { ...route, snapshot } },
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
  if (action.type === 'case/capture-group-toggled') {
    const current = route.captureCollapsed[action.questionId] ?? new Map();
    const collapsed = new Map(current);
    collapsed.set(action.groupKey, action.collapsed);
    return {
      ...state,
      routes: {
        caseReview: {
          ...route,
          captureCollapsed: {
            ...route.captureCollapsed,
            [action.questionId]: collapsed,
          },
        },
      },
    };
  }
  if (action.type === 'case/attribution-search-input') {
    return {
      ...state,
      routes: {
        caseReview: {
          ...route,
          attributionSearch: {
            ...route.attributionSearch,
            [action.questionId]: { query: action.query, people: [] },
          },
        },
      },
    };
  }
  if (action.type === 'case/attribution-search-results') {
    const current = route.attributionSearch[action.questionId];
    if (!current || current.query !== action.query) return state;
    return {
      ...state,
      routes: {
        caseReview: {
          ...route,
          attributionSearch: {
            ...route.attributionSearch,
            [action.questionId]: {
              query: action.query,
              people: action.people,
            },
          },
        },
      },
    };
  }
  if (action.type === 'case/attribution-search-cleared') {
    if (!(action.questionId in route.attributionSearch)) return state;
    const attributionSearch = { ...route.attributionSearch };
    delete attributionSearch[action.questionId];
    return {
      ...state,
      routes: {
        caseReview: { ...route, attributionSearch },
      },
    };
  }
  if (action.type === 'case/conversation-toggled') {
    if (
      route.snapshot?.access.conversation === 'hidden' ||
      !route.snapshot?.machine?.canToggleConversation
    ) {
      return state;
    }
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
  if (action.type === 'case/on-hold-changed' && route.snapshot?.caseRow) {
    const caseRow = {
      ...route.snapshot.caseRow,
      onHold: action.onHold,
      placedOnHoldAt: action.placedOnHoldAt,
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
  if (action.type === 'case/completion-pending') {
    if (action.pending === route.completionPending) return state;
    return {
      ...state,
      routes: {
        caseReview: { ...route, completionPending: action.pending },
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
          onclick: () => location.reload(),
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
  let active = false;
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const attributionTimers = new Map();
  /** @type {Map<string, string>} */
  const pendingAttributionQueries = new Map();
  const viewModel = new CaseReviewViewModel({
    client: context.client,
    saveQueue: context.saveQueue,
    caseId: params.id,
    caseType: params.caseType ?? null,
    currentUserId:
      context.chrome.currentUser?.id ?? context.currentUser?.id ?? '',
    capabilities: context.chrome.permissions ?? context.capabilities,
  });
  const questionsView = createQuestionPanelView();
  /**
   * The id every write addresses: the row that was actually loaded, which is
   * what `params.id` resolved to. The route param is only the seed, because the
   * effects are built with the route, before the load lands. Previously the four
   * write paths disagreed — two used `params.id`, two `caseRow.id` (#511).
   *
   * @type {string}
   */
  let loadedCaseId = params.id;
  const caseId = () => loadedCaseId;
  // Built here rather than in `start()`: a persistence path is not a place for a
  // window where the write silently does nothing. The store's `dispatch` is the
  // only part that does not exist yet, so the effects close over the mutable
  // local above — a no-op until `start()` swaps the real one in (#511).
  const save = createCaseReviewSaveEffect({
    saveQueue: context.saveQueue,
    caseId,
    dispatch: (action) => dispatch(action),
  });
  const appeals = createAppealEffects({
    saveQueue: context.saveQueue,
    caseId,
    dispatch: (action) => dispatch(action),
    onCaseRow: (row) => {
      viewModel.caseRow = row;
    },
  });
  let requestedOnHold = false;
  /** @type {null | {
   *   root: HTMLElement,
   *   status: HTMLElement,
   *   header: HTMLElement,
   *   tablist: HTMLElement,
   *   holdControl: HTMLElement,
   *   panels: Record<string, HTMLElement>,
   *   conversation: HTMLElement,
   *   completion: HTMLElement,
   * }} */
  let shell = null;

  /** @param {string} questionId */
  function clearAttributionSearch(questionId) {
    const timer = attributionTimers.get(questionId);
    if (timer !== undefined) clearTimeout(timer);
    attributionTimers.delete(questionId);
    pendingAttributionQueries.delete(questionId);
    dispatch({ type: 'case/attribution-search-cleared', questionId });
  }

  /** @param {string} questionId @param {string} query */
  function requestAttributionSearch(questionId, query) {
    dispatch({ type: 'case/attribution-search-input', questionId, query });
    const timer = attributionTimers.get(questionId);
    if (timer !== undefined) clearTimeout(timer);
    attributionTimers.delete(questionId);
    pendingAttributionQueries.set(questionId, query);
    const trimmed = query.trim();
    if (!trimmed || !context.client) return;
    attributionTimers.set(
      questionId,
      setTimeout(() => {
        attributionTimers.delete(questionId);
        void context.client.searchPeople(trimmed).then((people) => {
          if (active && pendingAttributionQueries.get(questionId) === query) {
            dispatch({
              type: 'case/attribution-search-results',
              questionId,
              query,
              people,
            });
          }
        });
      }, 200)
    );
  }

  /**
   * The live Answers, which every Answer action reads as its input.
   *
   * Not `snapshot.answers`: store renders are microtask-coalesced, so a
   * callback that captured a render's Answers is one edit behind for as long as
   * it outlives that render — and memoised Question cards keep their callbacks
   * across renders by design (#202). Reading here instead keeps the property
   * the retired signal gave these mutations: the input is whatever was last
   * written, not whatever was last drawn. Re-synced from the snapshot on every
   * render, so a reload or a conflict resolution still wins (#510).
   *
   * @type {Record<string, import('../sharepoint-client.js').Answer>}
   */
  let currentAnswers = {};

  /**
   * The page's only Answer writer. Every mutation is a pure action returning
   * either the next Answers or `null` for "write nothing"; from here on there
   * is one store update and one SaveQueue enqueue, so the two cannot diverge
   * (#510).
   *
   * @param {Record<string, import('../sharepoint-client.js').Answer> | null} next
   */
  function editAnswers(next) {
    if (next === null) return;
    currentAnswers = next;
    save.answersEdited(next);
  }

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
    const holdControl = h('div', {
      className: 'cora-case-review__hold-control',
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
      h(
        'div',
        { className: 'cora-tabs' },
        h(
          'div',
          { className: 'cora-case-review__tab-strip' },
          tablist,
          holdControl
        ),
        ...Object.values(panels)
      ),
      conversation,
      completion
    );
    // The router leaves the previous route's DOM in the container; morphing
    // over it would patch those foreign nodes in place and leave this shell's
    // cached part references detached. A fresh mount replaces the content
    // outright so every later per-part morph targets in-document nodes.
    container.replaceChildren(root);
    shell = {
      root,
      status,
      header,
      tablist,
      holdControl,
      panels,
      conversation,
      completion,
    };
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
    const caseRow = snapshot.caseRow;
    const config = snapshot.config;
    // The Answer actions read `currentAnswers`, not this render's snapshot, so
    // that a memoised card's surviving callback is never one edit behind. Re-sync
    // it here for the same reason the on-hold latch below re-syncs: a load,
    // refresh or conflict resolution reaches the store without passing through
    // `editAnswers`, and the store is still the owner (#510).
    currentAnswers = snapshot.answers;
    loadedCaseId = caseRow.id;

    /** @param {string} questionId @param {string | string[]} value */
    const onAnswer = (questionId, value) =>
      editAnswers(
        answerEdited({
          answers: currentAnswers,
          catalogue: snapshot.catalogue,
          questionId,
          value,
          canEdit: snapshot.access.questions === 'edit',
        })
      );

    /** @param {string} questionId @param {{ loginName: string, displayName: string } | null} party */
    const selectAttribution = (questionId, party) => {
      editAnswers(
        failureAttributed({
          answers: currentAnswers,
          questionId,
          attributedParty: party,
          canAttribute: snapshot.machine?.canAttribute ?? false,
        })
      );
      clearAttributionSearch(questionId);
    };

    // The panel renderers' half of the contract. Rebuilt per render because
    // `onAnswer` and `selectAttribution` close over this render's snapshot;
    // `currentAnswers` stays a getter so a memoised card's surviving callback
    // still reads the last Answers *written*, not the last ones drawn (#510).
    /** @type {import('./cora-case-review/section-panels.js').PanelActions} */
    const panelActions = {
      questionsView,
      currentAnswers: () => currentAnswers,
      editAnswers,
      onAnswer,
      selectAttribution,
      requestAttributionSearch,
      save,
      appeals,
    };

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
              onclick: () =>
                tools.dispatch({ type: 'case/conversation-toggled' }),
            },
            snapshot.sectionHeadings.conversation
          )
        : null,
    ]);

    const tabs = visibleCaseTabs(snapshot);
    // Store renders are microtask-coalesced, so rapid clicks can outpace the
    // rendered snapshot; re-sync this latch on every render.
    requestedOnHold = caseRow.onHold === true;
    tools.morph(
      parts.holdControl,
      state.chrome.permissions.isReviewer &&
        caseRow.status === CASE_STATUS.IN_PROGRESS
        ? h(
            'button',
            {
              type: 'button',
              className: 'cora-case-review__hold-toggle',
              'aria-pressed': String(caseRow.onHold === true),
              onclick: () => {
                requestedOnHold = !requestedOnHold;
                save.onHoldChanged(requestedOnHold);
              },
            },
            'On hold'
          )
        : null
    );
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
            onclick: () =>
              tools.dispatch({ type: 'case/tab-selected', id: entry.id }),
            onkeydown: (/** @type {KeyboardEvent} */ event) =>
              selectAdjacentTab(event, tabs, route.activeTab, tools.dispatch),
          },
          snapshot.sectionLabels[entry.id]
        );
      })
    );

    // Every Section renders the same three ways: resolve visibility, toggle
    // `hidden` (panels stay mounted so morph() keeps focus/caret/scroll across
    // tab switches — ADR-0034/CORE-2), then morph in the panel its renderer
    // returns. What differs per Section lives in SECTION_PANELS, not here.
    const panelContext = {
      snapshot,
      caseRow,
      config,
      route,
      dispatch: tools.dispatch,
      actions: panelActions,
    };
    for (const entry of tabEntries()) {
      const panel = parts.panels[entry.id];
      const visible = snapshot.access[entry.id] !== 'hidden';
      panel.hidden = !visible || route.activeTab !== entry.id;
      const render = SECTION_PANELS[entry.id];
      tools.morph(panel, visible && render ? render(panelContext) : null);
    }

    parts.conversation.hidden =
      snapshot.access.conversation === 'hidden' || route.conversationHidden;
    tools.morph(
      parts.conversation,
      snapshot.access.conversation === 'hidden'
        ? null
        : conversationView({
            messages: caseRow.conversation,
            access: snapshot.access.conversation,
            heading: snapshot.sectionHeadings.conversation,
            onSend: async (body) => {
              await postConversationMessage({
                client: context.client,
                saveQueue: context.saveQueue,
                caseId: params.id,
                messages: caseRow.conversation,
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
    const completion = completionControl({
      machine: snapshot.machine,
      caseRow,
      catalogue: snapshot.catalogue,
      answers: snapshot.answers,
      allAnswered: snapshot.allAnswered,
    });
    tools.morph(
      parts.completion,
      completion.visible
        ? h(
            'div',
            { className: 'cora-completion' },
            h(
              'button',
              {
                className: 'cora-complete-btn',
                disabled: route.completionPending || completion.disabled,
                title: completion.reason ?? '',
                onclick: async () => {
                  const patchFields = completionPatch({
                    machine: snapshot.machine,
                    caseRow,
                    catalogue: snapshot.catalogue,
                    answers: snapshot.answers,
                    allAnswered: snapshot.allAnswered,
                    computeOutcome: config.computeOutcome,
                    exportHash: snapshot.exportHash,
                  });
                  if (!patchFields) return;
                  tools.dispatch({
                    type: 'case/completion-pending',
                    pending: true,
                  });
                  try {
                    await completeCase({
                      caseId: caseRow.id,
                      client: context.client,
                      saveQueue: context.saveQueue,
                      patchFields,
                      caseListOptions: snapshot.caseListOptions,
                    });
                  } finally {
                    tools.dispatch({
                      type: 'case/completion-pending',
                      pending: false,
                    });
                  }
                },
              },
              completion.label
            ),
            // The gate's reason travels with the button rather than living only
            // on the Remediation tab, so it is legible from wherever the Reviewer
            // is standing (#499).
            ...(completion.reason
              ? [
                  h(
                    'p',
                    { className: 'cora-completion-reason' },
                    completion.reason
                  ),
                ]
              : [])
          )
        : null
    );
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
      active = true;
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
        active = false;
        for (const timer of attributionTimers.values()) clearTimeout(timer);
        attributionTimers.clear();
        pendingAttributionQueries.clear();
        questionsView.clear();
        dispatch = () => {};
        disposeSaveStatus();
      };
    },
  };
}
