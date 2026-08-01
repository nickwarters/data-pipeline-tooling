// @ts-check
import { ignoreAbortError } from '../lib/abort.js';
import { withAbortSignal } from '../services/abortable-client.js';
import { h } from '../lib/html.js';
import { patchRoute } from '../core/route-state.js';
import { caseRouteFor } from '../lib/case-route-links.js';
import { navigateTo } from '../lib/navigate.js';
import {
  Allocation,
  getAllocationAvailability,
} from '../components/sections/cora-allocation.js';
import {
  loadOwnerSummaries,
  OwnerSummary,
} from '../components/sections/cora-owner-summary.js';
import {
  initialResponsiblePartyState,
  reduceResponsibleParty,
  responsiblePartyPanelView,
} from './cora-responsible-party-dashboard.js';
import {
  ActionCentreView,
  initialActionCentreState,
  loadActionCentreCounts,
  loadActionCentrePage,
} from './dashboard/action-centre-view.js';
import { visibleReasons } from '../services/action-centre-model.js';
import { loadKpiModel } from '../evaluators/kpi-strip-model.js';
import { CASE_STATUS } from '../lib/case-statuses.js';
import { listCasesAcrossSources } from '../services/across-sources.js';
import {
  dataTableView,
  reduceTableSort,
  sortRequested,
} from '../views/data-table.js';
import {
  overdueCaseRowClass,
  standardCaseColumns,
} from '../views/case-columns.js';
import { visibleDashboardPanels } from './dashboard/panel-descriptors.js';
import { kpiStripView } from './dashboard/kpi-view.js';
import {
  controlsAppealsView,
  fetchOpenAppeals,
} from './dashboard/controls-view.js';

/** The two table names this page sorts by: used by both the views and the reducer. */
const REVIEWER_TABLE = 'reviewer';
const APPEALS_TABLE = 'appeals';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../views/data-table.js').TableSort} TableSort */
/** @typedef {import('../evaluators/kpi-strip-model.js').KpiLane} KpiLane */

/**
 * @typedef {Object} DashboardRouteState
 * @property {CaseRow[]} reviewerCases
 * @property {CaseRow[]} appealCases
 * @property {KpiLane[]} kpiLanes
 * @property {Set<string>} openKpiLanes
 * @property {Set<string>} expandedKpiTiles
 * @property {TableSort | null} reviewerSort
 * @property {string} reviewerFilterText
 * @property {string} reviewerStatusFilter
 * @property {TableSort | null} appealSort
 * @property {boolean} allocationEmpty
 * @property {boolean} allocationAtCapacity
 * @property {import('../components/sections/cora-owner-summary.js').OwnerSummary[]} ownerSummaries
 * @property {ReturnType<typeof initialActionCentreState>} actionCentre
 * @property {ReturnType<typeof initialResponsiblePartyState>} responsibleParty
 */

/**
 * @typedef {Object} DashboardState
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {{ dashboard: DashboardRouteState }} routes
 */

/** @param {DashboardRouteState} route @param {(action: any) => any} dispatch */
function reviewerCasesView(route, dispatch) {
  const text = route.reviewerFilterText.toLowerCase();
  const rows = route.reviewerCases.filter((row) => {
    if (
      route.reviewerStatusFilter &&
      row.status !== route.reviewerStatusFilter
    ) {
      return false;
    }
    if (!text) return true;
    return (
      (row.title || row.id).toLowerCase().includes(text) ||
      row.caseType.toLowerCase().includes(text) ||
      row.status.toLowerCase().includes(text)
    );
  });
  return h(
    'section',
    { className: 'cora-reviewer-cases' },
    h('h1', {}, 'Outstanding Cases'),
    h(
      'div',
      { className: 'cora-case-table-toolbar' },
      h('input', {
        className: 'cora-case-table-filter',
        type: 'text',
        value: route.reviewerFilterText,
        placeholder: 'Filter cases…',
        'aria-label': 'Filter cases',
        oninput: (/** @type {any} */ event) =>
          dispatch({
            type: 'reviewer-table/filter-text-changed',
            value: event.target?.value ?? '',
          }),
      }),
      h(
        'select',
        {
          className: 'cora-case-table-status-filter',
          value: route.reviewerStatusFilter,
          'aria-label': 'Filter by status',
          onchange: (/** @type {any} */ event) =>
            dispatch({
              type: 'reviewer-table/status-filter-changed',
              value: event.target?.value ?? '',
            }),
        },
        h('option', { value: '' }, 'All statuses'),
        // Derived from the lifecycle rather than listed by hand: a status added
        // to the Case lifecycle has to be filterable here, and nobody adding one
        // should have to remember that this file exists. Each option shows the
        // stored value verbatim, which is also what the Status column and the
        // free-text filter match on, so the three agree by construction.
        ...Object.values(CASE_STATUS).map((status) =>
          h('option', { value: status }, status)
        )
      )
    ),
    dataTableView({
      rows,
      columns: standardCaseColumns({
        onOpen: (row) => navigateTo(caseRouteFor(row)),
      }),
      sort: route.reviewerSort,
      onSort: (key) => dispatch(sortRequested(REVIEWER_TABLE, key)),
      emptyMessage: 'No outstanding cases.',
      rowKey: (row) => `${row.caseType}:${row.id}`,
      rowHref: caseRouteFor,
      rowClass: overdueCaseRowClass,
    })
  );
}

/** @param {ReturnType<typeof initialActionCentreState>} state @param {boolean} value */
function actionCentreScopeState(state, value) {
  return {
    ...state,
    needsActionNow: value,
    reasons: visibleReasons(state.allReasons, value),
    pages: {},
  };
}

/**
 * @param {DashboardState} state
 * @param {{
 *   dispatch: (action: any) => any,
 *   context: import('../setup/register-routes.js').AppContext,
 *   actionCentreActions?: {
 *     toggleNeedsAction: (state: ReturnType<typeof initialActionCentreState>, value: boolean) => void,
 *     toggleGroup: (state: ReturnType<typeof initialActionCentreState>, reason: import('../services/action-centre-model.js').Reason) => void,
 *     showMore: (state: ReturnType<typeof initialActionCentreState>, reason: import('../services/action-centre-model.js').Reason) => void,
 *   },
 *   dashboardActions?: { requestNextCase: () => void },
 * }} tools
 */
export function dashboardView(state, tools) {
  const route = state.routes.dashboard;
  const capabilities = state.chrome.permissions;
  const panels = visibleDashboardPanels(capabilities);
  const panelViews = {
    kpis: () =>
      kpiStripView({
        lanes: route.kpiLanes,
        openLanes: route.openKpiLanes,
        expandedTiles: route.expandedKpiTiles,
        onToggleLane: (role) =>
          tools.dispatch({ type: 'kpi/lane-toggled', role }),
        onToggleTile: (role, key) =>
          tools.dispatch({ type: 'kpi/tile-toggled', role, key }),
      }),
    actionCentre: () =>
      ActionCentreView(route.actionCentre, {
        onToggleNeedsAction: (value) =>
          tools.actionCentreActions?.toggleNeedsAction(
            route.actionCentre,
            value
          ),
        onToggleGroup: (reason) =>
          tools.actionCentreActions?.toggleGroup(route.actionCentre, reason),
        onShowMore: (reason) =>
          tools.actionCentreActions?.showMore(route.actionCentre, reason),
        onOpenCase: (row) => navigateTo(caseRouteFor(row)),
      }),
    ownerSummary: () => OwnerSummary({ summaries: route.ownerSummaries }),
    reviewerCases: () => reviewerCasesView(route, tools.dispatch),
    allocation: () =>
      Allocation({
        isEmpty: route.allocationEmpty,
        isAtCapacity: route.allocationAtCapacity,
        onRequestNextCase: () => tools.dashboardActions?.requestNextCase?.(),
      }),
    responsibleParty: () =>
      responsiblePartyPanelView(route.responsibleParty, tools, {
        navigateToConversation: true,
      }),
    appeals: () =>
      controlsAppealsView(route.appealCases, route.appealSort, (key) =>
        tools.dispatch(sortRequested(APPEALS_TABLE, key))
      ),
  };

  return h(
    'div',
    { className: 'cora-dashboard' },
    ...panels.map((key) => panelViews[key]())
  );
}

/**
 * @param {Record<string, string>} _params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {{
 *   loadKpis?: typeof loadKpiModel,
 *   loadAppeals?: typeof fetchOpenAppeals,
 *   listAcrossSources?: typeof listCasesAcrossSources,
 *   loadActionCounts?: typeof loadActionCentreCounts,
 *   loadActionPage?: typeof loadActionCentrePage,
 *   loadOwnerSummary?: typeof loadOwnerSummaries,
 *   loadAllocationAvailability?: typeof getAllocationAvailability,
 * }} [dependencies]
 */
export function createRouteSlice(
  _params,
  context,
  {
    loadKpis = loadKpiModel,
    loadAppeals = fetchOpenAppeals,
    listAcrossSources = listCasesAcrossSources,
    loadActionCounts = loadActionCentreCounts,
    loadActionPage = loadActionCentrePage,
    loadOwnerSummary = loadOwnerSummaries,
    loadAllocationAvailability = getAllocationAvailability,
  } = {}
) {
  /** @type {DashboardState} */
  const initialState = {
    chrome: context.chrome,
    routes: {
      dashboard: {
        reviewerCases: [],
        appealCases: [],
        kpiLanes: [],
        openKpiLanes: new Set(),
        expandedKpiTiles: new Set(),
        reviewerSort: null,
        reviewerFilterText: '',
        reviewerStatusFilter: '',
        appealSort: { key: 'raised', dir: 'asc' },
        allocationEmpty: false,
        allocationAtCapacity: false,
        ownerSummaries: [],
        actionCentre: initialActionCentreState(
          context.chrome.permissions,
          context.caseSources
        ),
        responsibleParty: initialResponsiblePartyState(
          context.chrome.currentUser.id
        ),
      },
    },
  };

  /** @type {any} */
  let effectTools = null;
  // The mount lifetime bound to the client's reads. Every dashboard
  // panel fans out one request per Case source, so navigating away
  // mid-load is exactly where cancellation pays. Null until `start()` binds it
  // — and it stays null when the mount has no client at all. Deliberately not
  // used by the allocation claim's own read/write/read cycle below: that
  // belongs to the write.
  /** @type {null | import('../sharepoint-client.js').SharePointClient} */
  let readClient = null;
  let allocationRequestActive = false;

  /**
   * The mount lifetime, read from the tools the route effect captured. The
   * module-scope effects below cannot see `start`'s locals, so they ask the
   * adapter instead of a second hand-rolled latch.
   */
  function effectsActive() {
    return effectTools?.isActive() === true;
  }

  /**
   * @param {{ candidates: unknown[], isAtCapacity: boolean }} availability
   */
  function publishAllocationAvailability(availability) {
    if (!effectsActive()) return;
    effectTools.dispatch({
      type: 'allocation/availability-changed',
      isEmpty:
        !availability.isAtCapacity && availability.candidates.length === 0,
      isAtCapacity: availability.isAtCapacity,
    });
  }

  async function refreshReviewerCases() {
    // `readClient` and `effectTools` are set and cleared together, so this is
    // the single source: there is no unwrapped client to fall back to.
    const client = readClient;
    const capabilities = effectTools?.context.chrome.permissions;
    if (!client || !capabilities?.isReviewer) return;
    /** @type {import('../sharepoint-client.js').CaseRow[]} */
    let rows;
    try {
      // "Outstanding" is In-progress plus Actions In Progress — the same two
      // statuses the Reviewer workload model counts — so the panel fetches both
      // rather than heading a single-status list with a word that means two.
      rows = await listAcrossSources(client, effectTools.context.caseSources, {
        anyOf: [
          { status: CASE_STATUS.IN_PROGRESS },
          { status: CASE_STATUS.ACTIONS_IN_PROGRESS },
        ],
        assignedReviewer: effectTools.context.chrome.currentUser.id,
      });
    } catch (error) {
      // Navigation cancelled the fan-out. That is not a dashboard failure:
      // nothing is dispatched, nothing is rendered, nothing is toasted.
      ignoreAbortError(error);
      return;
    }
    if (effectsActive()) {
      effectTools.dispatch({
        type: 'reviewer-cases/loaded',
        cases: rows,
      });
    }
  }

  /** @param {ReturnType<typeof initialActionCentreState>} actionState */
  async function refreshActionCounts(actionState) {
    const client = readClient;
    if (!client || typeof client.countCases !== 'function') return;
    /** @type {Awaited<ReturnType<typeof loadActionCounts>>} */
    let loaded;
    try {
      loaded = await loadActionCounts({
        client,
        sources: effectTools.context.caseSources,
        reasons: actionState.reasons,
        currentUserId: effectTools.context.chrome.currentUser.id,
      });
    } catch (error) {
      ignoreAbortError(error);
      return;
    }
    if (effectsActive()) {
      effectTools.dispatch({ type: 'action-centre/counts-loaded', ...loaded });
    }
  }

  /**
   * @param {ReturnType<typeof initialActionCentreState>} actionState
   * @param {import('../services/action-centre-model.js').Reason} reason
   * @param {number} skip
   */
  async function refreshActionPage(actionState, reason, skip) {
    const client = readClient;
    if (!client) return;
    /** @type {Awaited<ReturnType<typeof loadActionPage>>} */
    let loaded;
    try {
      loaded = await loadActionPage({
        client,
        sources: effectTools.context.caseSources,
        reason,
        currentUserId: effectTools.context.chrome.currentUser.id,
        skip,
      });
    } catch (error) {
      ignoreAbortError(error);
      return;
    }
    if (effectsActive()) {
      effectTools.dispatch({
        type: 'action-centre/page-loaded',
        reasonId: reason.id,
        skip,
        ...loaded,
      });
    }
  }

  const actionCentreActions = {
    /** @param {ReturnType<typeof initialActionCentreState>} actionState @param {boolean} value */
    toggleNeedsAction(actionState, value) {
      if (!effectTools || actionState.needsActionNow === value) return;
      const next = actionCentreScopeState(actionState, value);
      effectTools.dispatch({ type: 'action-centre/scope-changed', value });
      void refreshActionCounts(next);
      for (const reason of next.reasons) {
        if (next.expanded.has(reason.id)) {
          void refreshActionPage(next, reason, 0);
        }
      }
    },
    /** @param {ReturnType<typeof initialActionCentreState>} actionState @param {import('../services/action-centre-model.js').Reason} reason */
    toggleGroup(actionState, reason) {
      if (!effectTools) return;
      const wasOpen = actionState.expanded.has(reason.id);
      effectTools.dispatch({
        type: 'action-centre/group-toggled',
        reasonId: reason.id,
      });
      if (!wasOpen) void refreshActionPage(actionState, reason, 0);
    },
    /** @param {ReturnType<typeof initialActionCentreState>} actionState @param {import('../services/action-centre-model.js').Reason} reason */
    showMore(actionState, reason) {
      const skip = actionState.pages[reason.id]?.length ?? 0;
      void refreshActionPage(actionState, reason, skip);
    },
  };

  const dashboardActions = {
    async requestNextCase() {
      const tools = effectTools;
      // Deliberately the raw client: this flow writes, and neither the claim
      // PATCH nor the availability reads that bracket it may be cancelled
      // half-way by navigation. Only that bracketed read/write/read
      // cycle is protected — the `refreshReviewerCases()` below is an ordinary
      // cancellable read and uses the signalled client like any other.
      const client = tools?.context.client;
      if (!client || allocationRequestActive) return;
      allocationRequestActive = true;
      try {
        const availability = await loadAllocationAvailability({
          client,
          allocationSources: tools.context.allocationSources,
          currentUserId: tools.context.chrome.currentUser.id,
        });
        if (availability.isAtCapacity) {
          publishAllocationAvailability(availability);
          return;
        }
        for (const candidate of availability.candidates) {
          const result = await client.patchCase(
            candidate.id,
            { assignedReviewer: tools.context.chrome.currentUser.id },
            candidate.etag,
            candidate._listOptions
          );
          if (result.ok) {
            if (!effectsActive()) return;
            const [nextAvailability] = await Promise.all([
              loadAllocationAvailability({
                client,
                allocationSources: tools.context.allocationSources,
                currentUserId: tools.context.chrome.currentUser.id,
              }),
              refreshReviewerCases(),
            ]);
            publishAllocationAvailability(nextAvailability);
            return;
          }
        }
        publishAllocationAvailability({
          candidates: [],
          isAtCapacity: false,
        });
      } finally {
        allocationRequestActive = false;
      }
    },
  };

  return {
    initialState,
    reducer(/** @type {DashboardState} */ state, /** @type {any} */ action) {
      const route = state.routes.dashboard;
      if (action.type === 'reviewer-cases/loaded') {
        return patchRoute(state, 'dashboard', { reviewerCases: action.cases });
      }
      if (action.type === 'appeals/loaded') {
        return patchRoute(state, 'dashboard', { appealCases: action.cases });
      }
      if (action.type === 'owner-summaries/loaded') {
        return patchRoute(state, 'dashboard', {
          ownerSummaries: action.summaries,
        });
      }
      if (action.type === 'allocation/availability-changed') {
        return patchRoute(state, 'dashboard', {
          allocationEmpty: action.isEmpty,
          allocationAtCapacity: action.isAtCapacity,
        });
      }
      if (action.type === 'kpis/loaded') {
        return patchRoute(state, 'dashboard', {
          kpiLanes: action.lanes,
          openKpiLanes: new Set(
            action.lanes
              .filter((/** @type {KpiLane} */ lane) => lane.defaultOpen)
              .map((/** @type {KpiLane} */ lane) => lane.role)
          ),
          expandedKpiTiles: new Set(
            action.lanes.flatMap((/** @type {KpiLane} */ lane) =>
              lane.tiles
                .filter((tile) => tile.defaultExpanded)
                .map((tile) => `${lane.role}:${tile.key}`)
            )
          ),
        });
      }
      if (action.type === 'kpi/lane-toggled') {
        const open = new Set(route.openKpiLanes);
        if (open.has(action.role)) open.delete(action.role);
        else open.add(action.role);
        return patchRoute(state, 'dashboard', { openKpiLanes: open });
      }
      if (action.type === 'kpi/tile-toggled') {
        const id = `${action.role}:${action.key}`;
        const expanded = new Set(route.expandedKpiTiles);
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
        return patchRoute(state, 'dashboard', { expandedKpiTiles: expanded });
      }
      const reviewerSort = reduceTableSort(
        route.reviewerSort,
        action,
        REVIEWER_TABLE
      );
      if (reviewerSort) return patchRoute(state, 'dashboard', { reviewerSort });
      if (action.type === 'reviewer-table/filter-text-changed') {
        return patchRoute(state, 'dashboard', {
          reviewerFilterText: action.value,
        });
      }
      if (action.type === 'reviewer-table/status-filter-changed') {
        return patchRoute(state, 'dashboard', {
          reviewerStatusFilter: action.value,
        });
      }
      const appealSort = reduceTableSort(
        route.appealSort,
        action,
        APPEALS_TABLE
      );
      if (appealSort) return patchRoute(state, 'dashboard', { appealSort });
      if (action.type === 'action-centre/scope-changed') {
        return patchRoute(state, 'dashboard', {
          actionCentre: actionCentreScopeState(
            route.actionCentre,
            action.value
          ),
        });
      }
      if (action.type === 'action-centre/counts-loaded') {
        return patchRoute(state, 'dashboard', {
          actionCentre: {
            ...route.actionCentre,
            counts: action.counts,
            peeks: action.peeks,
            headline: action.headline,
          },
        });
      }
      if (action.type === 'action-centre/group-toggled') {
        const expanded = new Set(route.actionCentre.expanded);
        if (expanded.has(action.reasonId)) expanded.delete(action.reasonId);
        else expanded.add(action.reasonId);
        return patchRoute(state, 'dashboard', {
          actionCentre: { ...route.actionCentre, expanded },
        });
      }
      if (action.type === 'action-centre/page-loaded') {
        const existing =
          action.skip === 0
            ? []
            : (route.actionCentre.pages[action.reasonId] ?? []);
        const rows = [...existing, ...action.rows];
        return patchRoute(state, 'dashboard', {
          actionCentre: {
            ...route.actionCentre,
            pages: { ...route.actionCentre.pages, [action.reasonId]: rows },
            counts: action.exhausted
              ? { ...route.actionCentre.counts, [action.reasonId]: rows.length }
              : route.actionCentre.counts,
          },
        });
      }
      // The sub-reducer fall-through: `reduceResponsibleParty` signals "nothing
      // changed" by reference, and the dashboard must relay that identity.
      const responsibleParty = reduceResponsibleParty(
        route.responsibleParty,
        action
      );
      if (responsibleParty !== route.responsibleParty) {
        return patchRoute(state, 'dashboard', { responsibleParty });
      }
      return state;
    },
    view: (/** @type {DashboardState} */ state, /** @type {any} */ tools) =>
      dashboardView(state, {
        ...tools,
        actionCentreActions,
        dashboardActions,
      }),
    start(/** @type {any} */ tools) {
      effectTools = tools;
      const currentUser = tools.context.chrome.currentUser;
      const capabilities = tools.context.chrome.permissions;

      // The wrap happens inside the guard, never before it: a mount with no
      // client renders an empty dashboard, and binding the mount signal must
      // not be what turns that into a `cora-route-error`.
      if (tools.context.client) {
        const client = withAbortSignal(tools.context.client, tools.signal);
        readClient = client;
        if (capabilities.ownedCaseTypes.length > 0) {
          void loadOwnerSummary({
            client,
            ownedCaseTypes: capabilities.ownedCaseTypes,
            allCaseSources: tools.context.caseSources,
          })
            .then((summaries) => {
              if (tools.isActive()) {
                tools.dispatch({ type: 'owner-summaries/loaded', summaries });
              }
            })
            .catch(ignoreAbortError);
        }
        void loadKpis({
          client,
          currentUserId: currentUser.id,
          capabilities,
          caseSources: tools.context.caseSources,
          allCaseSources: tools.context.caseSources,
        })
          .then((lanes) => {
            if (tools.isActive())
              tools.dispatch({ type: 'kpis/loaded', lanes });
          })
          .catch(ignoreAbortError);
        if (capabilities.isControls) {
          void loadAppeals(client, tools.context.caseSources)
            .then((cases) => {
              if (tools.isActive())
                tools.dispatch({ type: 'appeals/loaded', cases });
            })
            .catch(ignoreAbortError);
        }
        void refreshReviewerCases();
        if (capabilities.isAdviser) {
          void listAcrossSources(client, tools.context.caseSources, {
            responsibleParty: currentUser.id,
          })
            .then((cases) => {
              if (tools.isActive()) {
                tools.dispatch({ type: 'responsible-party/loaded', cases });
              }
            })
            .catch(ignoreAbortError);
        }
        if (
          typeof client.countCases === 'function' &&
          initialState.routes.dashboard.actionCentre.reasons.length > 0
        ) {
          const actionState = initialState.routes.dashboard.actionCentre;
          void refreshActionCounts(actionState).then(() => {
            const [first] = actionState.reasons;
            if (!tools.isActive() || !first) return;
            tools.dispatch({
              type: 'action-centre/group-toggled',
              reasonId: first.id,
            });
            void refreshActionPage(actionState, first, 0);
          });
        }
      }

      return () => {
        effectTools = null;
        readClient = null;
      };
    },
  };
}
