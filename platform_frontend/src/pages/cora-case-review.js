// @ts-check
import { h } from '../lib/html.js';
import { LoadingState } from '../lib/empty-state.js';
import { StatusBanner } from '../components/base/cora-status-banner.js';
import { ignoreAbortError } from '../lib/abort.js';
import { withAbortSignal } from '../services/abortable-client.js';
import { patchRoute, patchSnapshot } from '../core/route-state.js';
import { CaseLoader } from '../lib/case-loader.js';
import { CASE_STATUS } from '../lib/case-statuses.js';
import {
  allApplicableAnswered,
  evaluate,
} from '../evaluators/applicability-evaluator.js';
import { anyRemediationRequired } from '../evaluators/remediation-status.js';
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
import { createDebouncedPeopleSearch } from '../lib/people-search.js';
import {
  answerEdited,
  issueCaptured,
} from './cora-case-review/answer-actions.js';
import { SECTION_PANELS } from './cora-case-review/section-panels.js';
import {
  completeCase,
  completionPatch,
} from './cora-case-review/completion-actions.js';
import { voidPatch } from './cora-case-review/void-actions.js';
import { voidReasonLabel } from '../lib/void-reasons.js';

/** @typedef {import('../services/save-queue.js').SaveStatus} SaveStatus */
/** @typedef {import('../lib/people-search.js').PeopleSearchState} PeopleSearchState */

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
 *   Set when the as-reviewed Question Bank was stamped on the row but its
 *   versioned export could not be fetched, so the *live* catalogue is what the
 *   page is showing. Rendered as a page-level banner — see `versionWarningView`.
 * @property {Record<import('../services/section-access.js').Section, import('../services/section-access.js').Mode>} access
 * @property {import('../sharepoint-client.js').ResolvedSectionLabels} sectionLabels
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
 * @property {SaveStatus} saveStatus
 * @property {boolean} conversationHidden
 * @property {boolean} completionPending
 * @property {boolean} voidPanelOpen
 * @property {string} voidReason The Void Reason key chosen in the open panel.
 * @property {boolean} voidPending
 * @property {Record<string, Map<string, boolean>>} captureCollapsed
 * @property {Record<string, Record<string, PeopleSearchState>>} captureSearch
 *   Per failed Answer, per `person` Issue Capture Field: the open people search.
 *   Nested rather than keyed by a joined string so a panel can hand one
 *   Answer's searches straight to its capture view.
 * @property {PeopleSearchState} responsiblePartySearch
 *   One search, not one per Question: the Responsible Party is a Case-level
 *   field, so there is only ever one of these boxes open.
 * @property {CaseReviewSnapshot | null} snapshot
 */

/**
 * @typedef {Object} CaseReviewState
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {{ caseReview: CaseReviewRouteState }} routes
 */

/**
 * @param {import('../core/chrome-state.js').ChromeState} chrome
 * @returns {CaseReviewState}
 */
export function createInitialCaseReviewState(chrome) {
  return {
    chrome,
    routes: {
      caseReview: {
        activeTab: '',
        saveStatus: 'saved',
        conversationHidden: true,
        completionPending: false,
        voidPanelOpen: false,
        voidReason: '',
        voidPending: false,
        captureCollapsed: {},
        captureSearch: {},
        responsiblePartySearch: { query: '', people: [], status: 'idle' },
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
 * The nested capture-search map with one field's entry replaced, or removed
 * when `entry` is null. Nested by Question then field because two pickers can
 * be open on different failed Answers at once and neither may see the other's
 * results.
 *
 * @param {CaseReviewRouteState['captureSearch']} captureSearch
 * @param {{ questionId: string, fieldKey: string }} target
 * @param {PeopleSearchState | null} entry
 * @returns {CaseReviewRouteState['captureSearch']}
 */
function withCaptureSearch(captureSearch, target, entry) {
  const forQuestion = { ...captureSearch[target.questionId] };
  if (entry) {
    forQuestion[target.fieldKey] = entry;
  } else {
    delete forQuestion[target.fieldKey];
  }
  return { ...captureSearch, [target.questionId]: forQuestion };
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
      // The Conversation panel starts collapsed on every load.
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
  // the store holds *now*. Completion navigates to `#/dashboard`, so the fold
  // has no reader today: defence-in-depth, not a fix for an observed stale read.
  //
  // Deliberately not `case/model-changed`, which replaces the whole snapshot:
  // the only snapshot the click handler can hand back is the one captured
  // before two network round-trips, so an Answer or Conversation edit
  // dispatched while the write was in flight would be reverted. Only the fields
  // travel, patched against current state.
  //
  // `snapshot.machine` holds its own load-time copy and does not advance with
  // the row, so `machine.mayResolveRemediation` can read false against a row
  // reading `Actions In Progress`. That is harmless only *because* completion
  // navigates away; whoever keeps the Reviewer on the Case after Send Actions
  // owns deriving the machine there. Deriving it here would convert the access
  // matrix from a load-time evaluation to a live one — a permission-surface
  // decision, not a staleness fix.
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
  if (action.type === 'case/capture-search-input') {
    const current = route.captureSearch[action.questionId]?.[action.fieldKey];
    // Prior matches remain visible/selectable for up to 200ms; retaining real
    // directory people avoids flicker until the new search starts.
    return patchRoute(state, 'caseReview', {
      captureSearch: withCaptureSearch(route.captureSearch, action, {
        query: action.query,
        people: action.query.trim() ? (current?.people ?? []) : [],
        status: 'idle',
      }),
    });
  }
  if (action.type === 'case/capture-search-results') {
    const current = route.captureSearch[action.questionId]?.[action.fieldKey];
    // Identity guard: an outcome for a query the Reviewer has typed past, or
    // for a field whose picker is no longer open.
    if (!current || current.query !== action.search.query) return state;
    return patchRoute(state, 'caseReview', {
      captureSearch: withCaptureSearch(
        route.captureSearch,
        action,
        action.search
      ),
    });
  }
  if (action.type === 'case/capture-search-cleared') {
    // Identity guard: clearing a search that is not open.
    if (!route.captureSearch[action.questionId]?.[action.fieldKey])
      return state;
    return patchRoute(state, 'caseReview', {
      captureSearch: withCaptureSearch(route.captureSearch, action, null),
    });
  }
  if (action.type === 'case/responsible-party-search-input') {
    // Prior matches remain visible/selectable for up to 200ms; retaining real
    // directory people avoids flicker until the new search starts.
    return patchRoute(state, 'caseReview', {
      responsiblePartySearch: {
        query: action.query,
        people: action.query.trim() ? route.responsiblePartySearch.people : [],
        status: 'idle',
      },
    });
  }
  if (action.type === 'case/responsible-party-search-results') {
    // Identity guard: an outcome for a query the Reviewer has typed past.
    if (route.responsiblePartySearch.query !== action.search.query)
      return state;
    return patchRoute(state, 'caseReview', {
      responsiblePartySearch: action.search,
    });
  }
  if (action.type === 'case/responsible-party-search-cleared') {
    // Identity guard: clearing a search that is not open. A failed search holds
    // no people either, so the status has to be part of that question.
    const current = route.responsiblePartySearch;
    if (
      current.query === '' &&
      current.people.length === 0 &&
      current.status === 'idle'
    )
      return state;
    return patchRoute(state, 'caseReview', {
      responsiblePartySearch: { query: '', people: [], status: 'idle' },
    });
  }
  // The Case-level Responsible Party, chosen on the Issues tab. Optimistic and
  // SaveQueue-debounced, so it is neither a `case/field-edited` (a generic
  // writer whose union is closed for this exact reason) nor a
  // `case/case-row-patched` (which folds back fields a confirmed PATCH already
  // wrote).
  //
  // `snapshot.machine` is deliberately left as it was. Access resolution reads
  // this field to grant the Responsible Party Role, and the machine bakes those
  // Roles and its access matrix from the row it was constructed with at load —
  // re-deriving it from an optimistic edit would move the permission surface
  // under the Reviewer mid-session, which is a decision, not a staleness fix.
  // Nothing needs it to: the reader that must react at once is the completion
  // control, and it reads the live Case Row.
  if (
    action.type === 'case/responsible-party-changed' &&
    route.snapshot?.caseRow
  ) {
    // Identity guard: re-selecting the person already named.
    if (route.snapshot.caseRow.responsibleParty === action.loginName) {
      return state;
    }
    return patchSnapshot(state, {
      caseRow: {
        ...route.snapshot.caseRow,
        responsibleParty: action.loginName,
        // Optimistic, exactly like the account beside it. Nothing persists this
        // — the next read of the Case brings the directory's own answer.
        responsiblePartyDisplayName: action.displayName,
      },
    });
  }
  if (
    action.type === 'case/responsible-party-cleared' &&
    route.snapshot?.caseRow
  ) {
    if (
      !route.snapshot.machine?.canEditIssues ||
      !route.snapshot.caseRow.responsibleParty
    ) {
      return state;
    }
    const { responsiblePartyDisplayName: _dropDisplayName, ...caseRow } =
      route.snapshot.caseRow;
    return patchSnapshot(state, {
      caseRow: { ...caseRow, responsibleParty: '' },
    });
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
    // This branch writes a computed key, so it is the one place a caller could
    // put any Case Row field into the store. `fieldEdited`'s parameter is typed
    // to the plain-text fields, but the reducer takes `any`, so a raw
    // `tools.dispatch` still compiles. Ignore anything else: `status` and
    // `assignedReviewer` are what `snapshot.machine`'s guards read from their
    // own load-time copy, so a write here would move the row while every `can*`
    // answer stayed behind.
    if (action.field !== 'notes' && action.field !== 'caseJustification') {
      return state;
    }
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
  if (action.type === 'case/void-panel-toggled') {
    // Closing forgets the reason: an abandoned panel must not leave a terminal
    // choice armed behind it.
    return patchRoute(state, 'caseReview', {
      voidPanelOpen: !route.voidPanelOpen,
      voidReason: '',
    });
  }
  if (action.type === 'case/void-reason-selected') {
    return patchRoute(state, 'caseReview', { voidReason: action.reasonKey });
  }
  if (action.type === 'case/void-pending') {
    // Identity guard: the pending flag is already what the effect reports.
    if (action.pending === route.voidPending) return state;
    return patchRoute(state, 'caseReview', { voidPending: action.pending });
  }
  if (action.type === 'case/save-status-changed') {
    // Identity guard: SaveQueue re-reports the status it last reported.
    if (action.status === route.saveStatus) return state;
    return patchRoute(state, 'caseReview', { saveStatus: action.status });
  }
  return state;
}

/**
 * The Question Bank fallback, made visible. When the as-reviewed export is
 * missing the page falls back to the live Question Bank — a degraded read beats
 * a blocked audit — and the Cases affected are exactly the ones under audit.
 * Page-level rather than tab-scoped, because it qualifies every Section; not a
 * toast, because a dismissed toast restores the silent-wrong state.
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
 * The terminal-state banner on a voided Case: what was decided, by whom and
 * when. It stands in the page header rather than on one tab because it
 * qualifies every Section — the Answers below it are frozen and there is no
 * Outcome to read.
 *
 * @param {import('../sharepoint-client.js').CaseRow} caseRow
 * @returns {HTMLElement}
 */
function voidBannerView(caseRow) {
  return h(
    'div',
    { key: 'void-banner', className: 'cora-void-banner', role: 'status' },
    h('span', { className: 'cora-void-pill' }, CASE_STATUS.VOID),
    h('p', {}, voidReasonLabel(caseRow.voidReason)),
    h(
      'p',
      {},
      `Voided by ${caseRow.voidedBy ?? '—'} on ${caseRow.voidedAt ?? '—'}`
    )
  );
}

/**
 * How the Conversation panel is presented, from the page's `?conversation=`
 * query param — the same opt-in-via-query-string convention as `?mock=1` and
 * `?simulate=1`. The query string is a defaulted parameter, so this reads an
 * injected value rather than reaching for a browser global.
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
 * The Responsible Party is a Case-level field: one search box, so one entry in
 * the debounce map, under this key.
 */
const RESPONSIBLE_PARTY_SEARCH_KEY = 'responsible-party';

/**
 * Case Review route slice. The loader adapts existing loading/domain behaviour
 * into store snapshots; the interim adapter owns only the unconverted Section
 * components.
 *
 * @param {Record<string, string>} params
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function createRouteSlice(params, context) {
  const panelMode = conversationPanelMode();
  let dispatch = (/** @type {any} */ _action) => {};
  // The adapter's mount lifetime, captured in start().
  let isSliceActive = () => false;
  /**
   * The client this route **reads** through. Swapped in `start()` for the same
   * client with the mount lifetime bound to its reads, so navigating
   * away cancels what this page still has in flight.
   *
   * Reads only. `context.saveQueue` was built at boot around the raw client and
   * is never rebound here: a queued Answer save must survive navigation, and
   * cancelling one would be data loss.
   *
   * @type {import('../sharepoint-client.js').SharePointClient}
   */
  let readClient = context.client;
  /**
   * Created in `start()`, once the mount lifetime exists to bind to. Nothing
   * reads it earlier: the first synchronous render runs before `start()` but
   * shows the loading placeholder from `snapshot: null`, never the loader.
   * @type {CaseLoader | null}
   */
  let caseLoader = null;
  const questionsView = createQuestionPanelView();
  /**
   * The id every write addresses: the row that was actually loaded, which is
   * what `params.id` resolved to. The route param is only the seed, because the
   * effects are built with the route, before the load lands.
   *
   * @type {string}
   */
  let loadedCaseId = params.id;
  const caseId = () => loadedCaseId;
  // Built here rather than in `start()`: a persistence path is not a place for a
  // window where the write silently does nothing. The store's `dispatch` is the
  // only part that does not exist yet, so the effects close over the mutable
  // local above — a no-op until `start()` swaps the real one in.
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
  // Built here for the same reason as the effects above.
  // One debounce per person Issue Capture Field per failed Answer, so two
  // pickers open at once do not share a timer. The debounce map is flat, so the
  // two halves are joined with a `:` — a Question Definition id may not contain
  // one (the namespaced answer keys depend on that), so the join is reversible.
  const capturePeopleSearch = createDebouncedPeopleSearch({
    client: context.client,
    isActive: () => isSliceActive(),
    onState: (key, search) => {
      dispatch({
        type: 'case/capture-search-results',
        ...splitCaptureSearchKey(key),
        search,
      });
    },
  });
  const responsiblePartyPeopleSearch = createDebouncedPeopleSearch({
    client: context.client,
    isActive: () => isSliceActive(),
    onState: (_key, search) => {
      dispatch({ type: 'case/responsible-party-search-results', search });
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
   * }} */
  let shell = null;

  /** @param {string} questionId @param {string} fieldKey */
  function captureSearchKey(questionId, fieldKey) {
    return `${questionId}:${fieldKey}`;
  }

  /** @param {string} key @returns {{ questionId: string, fieldKey: string }} */
  function splitCaptureSearchKey(key) {
    const separator = key.indexOf(':');
    return {
      questionId: key.slice(0, separator),
      fieldKey: key.slice(separator + 1),
    };
  }

  /** @param {string} questionId @param {string} fieldKey */
  function clearCaptureSearch(questionId, fieldKey) {
    capturePeopleSearch.clear(captureSearchKey(questionId, fieldKey));
    dispatch({ type: 'case/capture-search-cleared', questionId, fieldKey });
  }

  /** @param {string} questionId @param {string} fieldKey @param {string} query */
  function requestCaptureSearch(questionId, fieldKey, query) {
    dispatch({
      type: 'case/capture-search-input',
      questionId,
      fieldKey,
      query,
    });
    capturePeopleSearch.request(captureSearchKey(questionId, fieldKey), query);
  }

  function clearResponsiblePartySearch() {
    responsiblePartyPeopleSearch.clear(RESPONSIBLE_PARTY_SEARCH_KEY);
    dispatch({ type: 'case/responsible-party-search-cleared' });
  }

  /** @param {string} query */
  function requestResponsiblePartySearch(query) {
    dispatch({ type: 'case/responsible-party-search-input', query });
    responsiblePartyPeopleSearch.request(RESPONSIBLE_PARTY_SEARCH_KEY, query);
  }

  /**
   * The live Answers, which every Answer action reads as its input.
   *
   * Not `snapshot.answers`: store renders are microtask-coalesced, so a
   * callback that captured a render's Answers is one edit behind for as long as
   * it outlives that render — and memoised Question cards keep their callbacks
   * across renders by design. The input is whatever was last *written*, not
   * whatever was last drawn. Re-synced from the snapshot on every render, so a
   * reload or a conflict resolution still wins.
   *
   * @type {Record<string, import('../sharepoint-client.js').Answer>}
   */
  let currentAnswers = {};
  /** @type {string} */
  let currentResponsibleParty = '';

  /**
   * The page's only Answer writer. Every mutation is a pure action returning
   * either the next Answers or `null` for "write nothing"; from here on there
   * is one store update and one SaveQueue enqueue, so the two cannot diverge.
   *
   * @param {Record<string, import('../sharepoint-client.js').Answer> | null} next
   */
  function editAnswers(next) {
    if (next === null) return;
    currentAnswers = next;
    save.answersEdited(next);
  }

  /** @param {Element} container */
  function ensureShell(container) {
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
      conversation
    );
    // The router leaves the previous route's DOM in the container; rendering
    // over it would patch those foreign nodes in place and leave this shell's
    // cached part references detached. A fresh mount replaces the content
    // outright so every later per-part render targets in-document nodes.
    container.replaceChildren(root);
    shell = {
      root,
      status,
      header,
      tablist,
      holdControl,
      panels,
      conversation,
    };
    return shell;
  }

  /** @param {CaseReviewState} state @param {any} tools @param {Element} container */
  function renderRoute(state, tools, container) {
    const parts = ensureShell(container);
    const route = state.routes.caseReview;
    const snapshot = route.snapshot;
    tools.render(parts.status, StatusBanner({ status: route.saveStatus }));

    if (!snapshot) {
      tools.render(parts.header, LoadingState());
      return;
    }
    if (snapshot.error) {
      tools.render(parts.header, h('p', {}, snapshot.error));
      return;
    }
    if (snapshot.accessDenied) {
      tools.render(
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
    // a memoised card's surviving callback is never one edit behind. Re-sync
    // here because a load, refresh or conflict resolution reaches the store
    // without passing through `editAnswers`.
    currentAnswers = snapshot.answers;
    currentResponsibleParty = caseRow.responsibleParty;
    loadedCaseId = caseRow.id;

    /** @param {string} questionId @param {string | string[]} value */
    const onAnswer = (questionId, value) =>
      editAnswersForRoute(
        answerEdited({
          answers: currentAnswers,
          catalogue: snapshot.catalogue,
          questionId,
          value,
          canEdit: snapshot.access.questions === 'edit',
        })
      );

    /**
     * The one write path for every Issue Capture Field, whatever its type: a
     * typed string, a chosen person, or the clearing of either. The search
     * close is unconditional because only a person can have one open, and
     * closing one that never opened changes nothing.
     *
     * @param {string} questionId
     * @param {string} fieldKey
     * @param {import('../evaluators/issue-capture.js').CaptureValue | null} value
     */
    const captureEdited = (questionId, fieldKey, value) => {
      editAnswersForRoute(
        issueCaptured({
          answers: currentAnswers,
          captureGroups: config.captureGroups ?? [],
          questionId,
          fieldKey,
          value,
          canEditIssues: snapshot.machine?.canEditIssues ?? false,
        })
      );
      clearCaptureSearch(questionId, fieldKey);
    };

    const clearResponsibleParty = () => {
      if (!snapshot.machine?.canEditIssues) return;
      clearResponsiblePartySearch();
      if (!currentResponsibleParty) return;
      currentResponsibleParty = '';
      save.responsiblePartyCleared();
    };

    /**
     * Persist an Answer edit and clear a recipient when the last remediation
     * decision disappears from the live, applicable Answers.
     *
     * @param {Record<string, import('../sharepoint-client.js').Answer> | null} next
     */
    const editAnswersForRoute = (next) => {
      if (next === null) return;
      const hadRemediation = anyRemediationRequired(
        snapshot.catalogue,
        currentAnswers
      );
      const hasRemediation = anyRemediationRequired(snapshot.catalogue, next);
      editAnswers(next);
      if (hadRemediation && !hasRemediation) clearResponsibleParty();
    };

    /** @param {{ loginName: string, displayName: string }} party */
    const selectResponsibleParty = (party) => {
      if (!snapshot.machine?.canEditIssues) return;
      currentResponsibleParty = party.loginName;
      save.responsiblePartyChanged(party.loginName, party.displayName);
      clearResponsiblePartySearch();
    };

    const onComplete = async () => {
      const patchFields = completionPatch({
        machine: snapshot.machine,
        caseRow,
        catalogue: snapshot.catalogue,
        answers: snapshot.answers,
        allAnswered: snapshot.allAnswered,
        captureGroups: config.captureGroups ?? [],
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
        // Only the fields travel, never this closure's `snapshot` or `caseRow`:
        // both are as of the last render, two network round-trips ago, so
        // replaying either would revert a concurrent Answer or Conversation edit.
        // The reducer patches whatever the store holds now.
        if (persisted && tools.isActive()) {
          tools.dispatch({
            type: 'case/case-row-patched',
            fields: patchFields,
          });
        }
      } finally {
        // Both dispatches are post-`await`, so both take the mount-lifetime
        // guard — dispatching into a disposed mount still runs the reducer, and
        // only the render is suppressed.
        if (tools.isActive()) {
          tools.dispatch({
            type: 'case/completion-pending',
            pending: false,
          });
        }
      }
    };

    const onVoid = async () => {
      const patchFields = voidPatch({
        machine: snapshot.machine,
        config,
        reasonKey: route.voidReason,
      });
      if (!patchFields) return;
      tools.dispatch({ type: 'case/void-pending', pending: true });
      try {
        const persisted = await completeCase({
          caseId: caseId(),
          client: context.client,
          saveQueue: context.saveQueue,
          patchFields,
          caseListOptions: snapshot.caseListOptions,
        });
        // Only the fields travel, for the same reason completion sends only
        // its own: the snapshot in this closure is two round-trips old.
        if (persisted && tools.isActive()) {
          tools.dispatch({
            type: 'case/case-row-patched',
            fields: patchFields,
          });
        }
      } finally {
        if (tools.isActive()) {
          tools.dispatch({
            type: 'case/void-pending',
            pending: false,
          });
        }
      }
    };

    // The panel renderers' half of the contract. Rebuilt per render because
    // `onAnswer` and `captureEdited` close over this render's snapshot;
    // `currentAnswers` stays a getter so a memoised card's surviving callback
    // still reads the last Answers *written*, not the last ones drawn.
    /** @type {import('./cora-case-review/section-panels.js').PanelActions} */
    const panelActions = {
      questionsView,
      currentAnswers: () => currentAnswers,
      editAnswers: editAnswersForRoute,
      onAnswer,
      captureEdited,
      requestCaptureSearch,
      selectResponsibleParty,
      requestResponsiblePartySearch,
      save,
      appeals,
      onComplete,
      onVoid,
    };

    tools.render(parts.header, [
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
            snapshot.sectionLabels.conversation.tab
          )
        : null,
      caseRow.status === CASE_STATUS.VOID ? voidBannerView(caseRow) : null,
    ]);

    const tabs = visibleCaseTabs(snapshot);
    // Store renders are microtask-coalesced, so rapid clicks can outpace the
    // rendered snapshot; re-sync this latch on every render.
    requestedOnHold = caseRow.onHold === true;
    tools.render(
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
    tools.render(
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
          snapshot.sectionLabels[entry.id].tab
        );
      })
    );

    // Every Section renders the same three ways: resolve visibility, toggle
    // `hidden` (panels stay mounted so render() keeps focus/caret/scroll across
    // tab switches), then render the panel its view returns.
    // What differs per Section lives in SECTION_PANELS, not here.
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
      const panelView = SECTION_PANELS[entry.id];
      tools.render(
        panel,
        visible && panelView ? panelView(panelContext) : null
      );
    }

    parts.conversation.hidden =
      snapshot.access.conversation === 'hidden' || route.conversationHidden;
    tools.render(
      parts.conversation,
      snapshot.access.conversation === 'hidden'
        ? null
        : conversationView({
            messages: caseRow.conversation,
            access: snapshot.access.conversation,
            heading: snapshot.sectionLabels.conversation.heading,
            onSend: async (body) => {
              await postConversationMessage({
                client: context.client,
                saveQueue: context.saveQueue,
                caseId: caseId(),
                messages: caseRow.conversation,
                currentUser,
                roles: snapshot.machine?.roles ?? [],
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
  }

  return {
    initialState: createInitialCaseReviewState(context.chrome),
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
      // Bind the mount lifetime to this route's reads, then build the loader
      // around the bound client. `withAbortSignal` is total, so a
      // client-less mount degrades exactly as it did before rather than
      // failing the route here.
      readClient = withAbortSignal(context.client, tools.signal);
      caseLoader = new CaseLoader({
        client: readClient,
        saveQueue: context.saveQueue,
        caseId: params.id,
        caseType: params.caseType ?? null,
        currentUserId: context.chrome.currentUser?.id ?? '',
        capabilities: context.chrome.permissions,
      });
      const loader = caseLoader;
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
            client: readClient,
            caseId: caseId(),
            caseListOptions: loader.caseListOptions,
          })
            .then((row) => {
              if (row && tools.isActive()) {
                tools.dispatch({
                  type: 'case/conversation-changed',
                  messages: row.conversation,
                });
              }
            })
            .catch(ignoreAbortError);
        });
      }
      void loader
        .load()
        .then(() => {
          if (!tools.isActive()) return;
          tools.dispatch({
            type: 'case/load-finished',
            snapshot: loader.toStoreSnapshot(),
          });
        })
        .catch(ignoreAbortError);
      return () => {
        capturePeopleSearch.dispose();
        responsiblePartyPeopleSearch.dispose();
        questionsView.clear();
        dispatch = () => {};
        disposeSaveStatus();
      };
    },
  };
}
