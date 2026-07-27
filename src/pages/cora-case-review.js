// @ts-check
import { h } from '../lib/html.js';
import { patchRoute, patchSnapshot } from '../core/route-state.js';
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
 * @property {string | null} versionWarning
 *   Set when ADR-0021's as-reviewed Question Bank was stamped on the row but its
 *   versioned export could not be fetched, so the *live* catalogue is what the
 *   page is showing. Rendered as a page-level banner — see `versionWarningView`.
 * @property {Record<import('../services/section-access.js').Section, import('../services/section-access.js').Mode>} access
 * @property {Required<import('../sharepoint-client.js').SectionLabels>} sectionLabels
 * @property {Required<import('../sharepoint-client.js').SectionLabels>} sectionHeadings
 * @property {import('../lib/case-machine.js').CaseMachine | null} machine
 * @property {import('../sharepoint-client.js').CaseListOptions} caseListOptions
 */

/**
 * The route slice's own state. Named rather than inlined into `CaseReviewState`
 * because `section-panels.js` reads it too — a panel renderer receives this
 * object on its context, and referencing one typedef from both places is what
 * keeps the two from drifting.
 *
 * @typedef {Object} CaseReviewRouteState
 * @property {string} activeTab
 * @property {string} panelMode
 * @property {SaveStatus} saveStatus
 * @property {boolean} conversationHidden
 * @property {boolean} completionPending
 * @property {Record<string, Map<string, boolean>>} captureCollapsed
 * @property {Record<string, { query: string, people: import('../sharepoint-client.js').PersonResult[] }>} attributionSearch
 * @property {CaseReviewSnapshot | null} snapshot
 */

/**
 * @typedef {Object} CaseReviewState
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {{ caseReview: CaseReviewRouteState }} routes
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
    return patchRoute(state, 'caseReview', {
      snapshot: action.snapshot,
      activeTab: tabs[0]?.id ?? '',
      // The Conversation panel starts collapsed on every load (#537).
      conversationHidden: true,
    });
  }
  if (action.type === 'case/model-changed') {
    const tabs = visibleCaseTabs(action.snapshot);
    const activeTab = tabs.some((entry) => entry.id === route.activeTab)
      ? route.activeTab
      : (tabs[0]?.id ?? '');
    return patchRoute(state, 'caseReview', {
      snapshot: action.snapshot,
      activeTab,
    });
  }
  // The lifecycle fields a completion write persisted, folded into the Case Row
  // the store holds *now* (#557). Deliberately not `case/model-changed`: that
  // replaces the whole snapshot, and the only snapshot the click handler can
  // hand back is the one captured before two network round-trips — so an Answer
  // or Conversation edit dispatched while the write was in flight would be
  // reverted, and the Answer-action owner re-synced to the stale map on the next
  // render. Patching against current state here is the same idiom
  // `case/answers-edited` below uses.
  //
  // `case/model-changed`'s `activeTab` recompute is not wanted and not repeated:
  // tab visibility reads `snapshot.access` only, which a Case Row patch cannot
  // move.
  //
  // `snapshot.machine` holds its own load-time copy and does not advance with
  // the row, so on the non-terminal Send Actions path the two now actively
  // disagree — `machine.mayResolveRemediation` false against a row reading
  // `Actions In Progress`. That divergence is sanctioned and belongs to #554,
  // which owns how the machine stops being a separate copy; rebuilding it here
  // as a side effect is explicitly out of scope.
  if (action.type === 'case/case-row-patched' && route.snapshot?.caseRow) {
    return patchSnapshot(state, {
      caseRow: { ...route.snapshot.caseRow, ...action.fields },
    });
  }
  if (action.type === 'case/answers-edited' && route.snapshot) {
    const applicableIds = evaluate(route.snapshot.catalogue, action.answers);
    const applicableQuestions = route.snapshot.catalogue.filter((question) =>
      applicableIds.has(question.id)
    );
    return patchSnapshot(state, {
      answers: action.answers,
      applicableQuestions,
      allAnswered: allApplicableAnswered(
        route.snapshot.catalogue,
        action.answers
      ),
      caseRow: route.snapshot.caseRow
        ? { ...route.snapshot.caseRow, answers: action.answers }
        : null,
    });
  }
  if (action.type === 'case/tab-selected') {
    const visible = visibleCaseTabs(route.snapshot).some(
      (entry) => entry.id === action.id
    );
    // Identity guard: re-selecting the active tab must not re-render.
    if (!visible || action.id === route.activeTab) return state;
    return patchRoute(state, 'caseReview', { activeTab: action.id });
  }
  if (action.type === 'case/capture-group-toggled') {
    const current = route.captureCollapsed[action.questionId] ?? new Map();
    const collapsed = new Map(current);
    collapsed.set(action.groupKey, action.collapsed);
    return patchRoute(state, 'caseReview', {
      captureCollapsed: {
        ...route.captureCollapsed,
        [action.questionId]: collapsed,
      },
    });
  }
  if (action.type === 'case/attribution-search-input') {
    return patchRoute(state, 'caseReview', {
      attributionSearch: {
        ...route.attributionSearch,
        [action.questionId]: { query: action.query, people: [] },
      },
    });
  }
  if (action.type === 'case/attribution-search-results') {
    const current = route.attributionSearch[action.questionId];
    // Identity guard: results for a query the reviewer has typed past.
    if (!current || current.query !== action.query) return state;
    return patchRoute(state, 'caseReview', {
      attributionSearch: {
        ...route.attributionSearch,
        [action.questionId]: { query: action.query, people: action.people },
      },
    });
  }
  if (action.type === 'case/attribution-search-cleared') {
    // Identity guard: clearing a search that is not open.
    if (!(action.questionId in route.attributionSearch)) return state;
    const attributionSearch = { ...route.attributionSearch };
    delete attributionSearch[action.questionId];
    return patchRoute(state, 'caseReview', { attributionSearch });
  }
  if (action.type === 'case/conversation-toggled') {
    if (
      route.snapshot?.access.conversation === 'hidden' ||
      !route.snapshot?.machine?.canToggleConversation
    ) {
      return state;
    }
    return patchRoute(state, 'caseReview', {
      conversationHidden: !route.conversationHidden,
    });
  }
  if (action.type === 'case/conversation-changed' && route.snapshot?.caseRow) {
    return patchSnapshot(state, {
      caseRow: { ...route.snapshot.caseRow, conversation: action.messages },
    });
  }
  if (action.type === 'case/field-edited' && route.snapshot?.caseRow) {
    return patchSnapshot(state, {
      caseRow: { ...route.snapshot.caseRow, [action.field]: action.value },
    });
  }
  if (action.type === 'case/on-hold-changed' && route.snapshot?.caseRow) {
    return patchSnapshot(state, {
      caseRow: {
        ...route.snapshot.caseRow,
        onHold: action.onHold,
        placedOnHoldAt: action.placedOnHoldAt,
      },
    });
  }
  if (action.type === 'case/completion-pending') {
    // Identity guard: the pending flag is already what the effect reports.
    if (action.pending === route.completionPending) return state;
    return patchRoute(state, 'caseReview', {
      completionPending: action.pending,
    });
  }
  if (action.type === 'case/save-status-changed') {
    // Identity guard: SaveQueue re-reports the status it last reported.
    if (action.status === route.saveStatus) return state;
    return patchRoute(state, 'caseReview', { saveStatus: action.status });
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
 * ADR-0021 Step 4's fallback, made visible. When the as-reviewed export is
 * missing the page falls back to the live Question Bank — deliberately, because
 * a degraded read beats a blocked audit — but until #513 nothing said so, and
 * the Cases affected are exactly the ones under audit. Page-level rather than
 * tab-scoped: it qualifies every Section, not one of them. Not a toast, because
 * a dismissed toast restores the silent-wrong state this exists to end.
 *
 * @param {string | null} warning
 * @returns {HTMLElement | null}
 */
function versionWarningView(warning) {
  if (!warning) return null;
  return h(
    'div',
    {
      key: 'version-warning',
      className: 'cora-banner cora-banner-warning',
      role: 'status',
      'aria-live': 'polite',
    },
    h(
      'p',
      { className: 'cora-banner-text' },
      'The as-reviewed Question Bank for this Case could not be loaded. ' +
        'You are seeing the current Question Bank, which may differ from ' +
        'what was reviewed at the time.'
    )
  );
}

/**
 * How the Conversation panel is presented, from the page's `?conversation=`
 * query param — the same opt-in-via-query-string convention as `?mock=1` and
 * `?simulate=1` (`pages/question-bank/question-bank-flags.js`), and read the
 * same way: the query string is a defaulted parameter, so this is a read of an
 * injected value rather than a reach for a browser global, and a caller with no
 * `location` passes its own string instead of the function testing for one
 * (#547).
 *
 * @param {string} [search] query string; defaults to the current page's
 * @returns {string}
 */
export function conversationPanelMode(
  search = /** @type {any} */ (globalThis).location?.search ?? ''
) {
  return new URLSearchParams(search).get('conversation') ?? 'popover';
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
  const panelMode = conversationPanelMode();
  let dispatch = (/** @type {any} */ _action) => {};
  // The adapter's mount lifetime, captured in start() (#517).
  let isSliceActive = () => false;
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
          if (
            isSliceActive() &&
            pendingAttributionQueries.get(questionId) === query
          ) {
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
      versionWarningView(snapshot.versionWarning),
      h('h1', { key: 'title' }, snapshot.caseRow.title),
      h(
        'p',
        { key: 'reviewer' },
        `Reviewer: ${snapshot.caseRow.assignedReviewer}`
      ),
      snapshot.machine?.canToggleConversation
        ? h(
            'button',
            {
              key: 'conversation-toggle',
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
                caseId: caseId(),
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
                    const persisted = await completeCase({
                      caseId: caseId(),
                      client: context.client,
                      saveQueue: context.saveQueue,
                      patchFields,
                      caseListOptions: snapshot.caseListOptions,
                    });
                    // Fold the persisted transition into the store, the same way
                    // every other Case Row transition does. Until #557 this was
                    // the one write whose fields never reached the store, and
                    // the only reason nothing read the stale row was that
                    // completion navigates away — including on the Send Actions
                    // path, which is not the end of the Case (#557).
                    //
                    // Only the fields travel, never this closure's `snapshot` or
                    // `caseRow`: both are as of the last render, which is two
                    // network round-trips ago by the time we get here. The
                    // reducer patches whatever the store holds now, so a
                    // concurrent Answer or Conversation edit survives.
                    if (persisted && tools.isActive()) {
                      tools.dispatch({
                        type: 'case/case-row-patched',
                        fields: patchFields,
                      });
                    }
                  } finally {
                    // Both dispatches are post-`await`, so both take the #517
                    // guard — dispatching into a disposed mount still runs the
                    // reducer, and only the render is suppressed.
                    if (tools.isActive()) {
                      tools.dispatch({
                        type: 'case/completion-pending',
                        pending: false,
                      });
                    }
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
      isSliceActive = tools.isActive;
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
            caseId: caseId(),
            caseListOptions: viewModel.caseListOptions,
          }).then((row) => {
            if (row && tools.isActive()) {
              tools.dispatch({
                type: 'case/conversation-changed',
                messages: row.conversation,
              });
            }
          });
        });
      }
      void viewModel.load().then(() => {
        if (!tools.isActive()) return;
        tools.dispatch({
          type: 'case/load-finished',
          snapshot: viewModel.toStoreSnapshot(),
        });
      });
      return () => {
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
