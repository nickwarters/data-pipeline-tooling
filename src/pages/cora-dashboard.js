// @ts-check
import { h } from '../lib/html.js';
import { caseRouteFor } from '../lib/case-route-links.js';
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
import { isOverdue } from '../evaluators/overdue-evaluator.js';
import { loadKpiModel } from '../evaluators/kpi-strip-model.js';
import { CASE_STATUS } from '../lib/case-statuses.js';
import { listCasesAcrossSources } from '../services/across-sources.js';
import { dataTableView, nextTableSort } from '../views/data-table.js';
import { visibleDashboardPanels } from './dashboard/panel-descriptors.js';
import { kpiStripView } from './dashboard/kpi-view.js';
import {
  controlsAppealsView,
  fetchOpenAppeals,
} from './dashboard/controls-view.js';

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

/** @returns {import('../views/data-table.js').ColumnDescriptor<CaseRow>[]} */
export function reviewerCaseColumns() {
  return [
    {
      key: 'reference',
      label: 'Reference',
      value: (row) => row.title || row.id,
      sortable: true,
      href: caseRouteFor,
    },
    { key: 'caseType', label: 'Case Type', value: 'caseType', sortable: true },
    {
      key: 'relatedDate',
      label: 'Related Date',
      value: (row) => /** @type {any} */ (row).relatedDate || '',
      sortable: true,
    },
    {
      key: 'dueDate',
      label: 'Due Date',
      value: (row) => row.dueDate || '',
      sortable: true,
    },
    { key: 'status', label: 'Status', value: 'status', sortable: true },
    {
      key: 'assigned',
      label: 'Assigned',
      value: (row) => row.created || '',
      sortable: true,
    },
    {
      key: 'actions',
      label: 'Actions',
      value: (row) => row.title || row.id,
      format: (value, row) =>
        h(
          'button',
          {
            type: 'button',
            className: 'cora-case-open-btn',
            'aria-label': `Open ${value}`,
            onclick: () => {
              location.hash = caseRouteFor(row);
            },
          },
          'Open'
        ),
    },
  ];
}

/** @param {DashboardRouteState} route @param {(action: any) => any} dispatch */
export function reviewerCasesView(route, dispatch) {
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
        h('option', { value: CASE_STATUS.IN_PROGRESS }, 'In Progress'),
        h('option', { value: CASE_STATUS.COMPLETED }, CASE_STATUS.COMPLETED)
      )
    ),
    dataTableView({
      rows,
      columns: reviewerCaseColumns(),
      sort: route.reviewerSort,
      onSort: (key) => dispatch({ type: 'reviewer-table/sort-requested', key }),
      emptyMessage: 'No outstanding cases.',
      rowKey: (row) => `${row.caseType}:${row.id}`,
      rowHref: caseRouteFor,
      rowClass: (row) =>
        row.overdue ? 'cora-case-row cora-case-row--overdue' : 'cora-case-row',
    })
  );
}

/** @param {ReturnType<typeof initialActionCentreState>} state @param {boolean} value */
export function actionCentreScopeState(state, value) {
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
        onOpenCase: (row) => {
          location.hash = caseRouteFor(row);
        },
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
        tools.dispatch({ type: 'appeals-table/sort-requested', key })
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
        actionCentre: initialActionCentreState(context.chrome.permissions),
        responsibleParty: initialResponsiblePartyState(
          context.chrome.currentUser.id
        ),
      },
    },
  };

  /** @type {any} */
  let effectTools = null;
  let allocationRequestActive = false;

  /**
   * The mount lifetime, read from the tools the route effect captured. The
   * module-scope effects below cannot see `start`'s locals, so they ask the
   * adapter instead of a second hand-rolled latch (#517).
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
    const client = effectTools?.context.client;
    const capabilities = effectTools?.context.chrome.permissions;
    if (!client || !capabilities?.isReviewer) return;
    const rows = await listAcrossSources(
      client,
      effectTools.context.caseSources,
      {
        status: CASE_STATUS.IN_PROGRESS,
        assignedReviewer: effectTools.context.chrome.currentUser.id,
      }
    );
    if (effectsActive()) {
      effectTools.dispatch({
        type: 'reviewer-cases/loaded',
        cases: rows.map((row) => ({ ...row, overdue: isOverdue(row) })),
      });
    }
  }

  /** @param {ReturnType<typeof initialActionCentreState>} actionState */
  async function refreshActionCounts(actionState) {
    const client = effectTools?.context.client;
    if (!client || typeof client.countCases !== 'function') return;
    const loaded = await loadActionCounts({
      client,
      sources: effectTools.context.caseSources,
      reasons: actionState.reasons,
      currentUserId: effectTools.context.chrome.currentUser.id,
    });
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
    const client = effectTools?.context.client;
    if (!client) return;
    const loaded = await loadActionPage({
      client,
      sources: effectTools.context.caseSources,
      reason,
      currentUserId: effectTools.context.chrome.currentUser.id,
      skip,
    });
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
        return {
          ...state,
          routes: { dashboard: { ...route, reviewerCases: action.cases } },
        };
      }
      if (action.type === 'appeals/loaded') {
        return {
          ...state,
          routes: { dashboard: { ...route, appealCases: action.cases } },
        };
      }
      if (action.type === 'owner-summaries/loaded') {
        return {
          ...state,
          routes: {
            dashboard: { ...route, ownerSummaries: action.summaries },
          },
        };
      }
      if (action.type === 'allocation/availability-changed') {
        return {
          ...state,
          routes: {
            dashboard: {
              ...route,
              allocationEmpty: action.isEmpty,
              allocationAtCapacity: action.isAtCapacity,
            },
          },
        };
      }
      if (action.type === 'kpis/loaded') {
        return {
          ...state,
          routes: {
            dashboard: {
              ...route,
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
            },
          },
        };
      }
      if (action.type === 'kpi/lane-toggled') {
        const open = new Set(route.openKpiLanes);
        if (open.has(action.role)) open.delete(action.role);
        else open.add(action.role);
        return {
          ...state,
          routes: { dashboard: { ...route, openKpiLanes: open } },
        };
      }
      if (action.type === 'kpi/tile-toggled') {
        const id = `${action.role}:${action.key}`;
        const expanded = new Set(route.expandedKpiTiles);
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
        return {
          ...state,
          routes: { dashboard: { ...route, expandedKpiTiles: expanded } },
        };
      }
      if (action.type === 'reviewer-table/sort-requested') {
        return {
          ...state,
          routes: {
            dashboard: {
              ...route,
              reviewerSort: nextTableSort(route.reviewerSort, action.key),
            },
          },
        };
      }
      if (action.type === 'reviewer-table/filter-text-changed') {
        return {
          ...state,
          routes: {
            dashboard: { ...route, reviewerFilterText: action.value },
          },
        };
      }
      if (action.type === 'reviewer-table/status-filter-changed') {
        return {
          ...state,
          routes: {
            dashboard: { ...route, reviewerStatusFilter: action.value },
          },
        };
      }
      if (action.type === 'appeals-table/sort-requested') {
        return {
          ...state,
          routes: {
            dashboard: {
              ...route,
              appealSort: nextTableSort(route.appealSort, action.key),
            },
          },
        };
      }
      if (action.type === 'action-centre/scope-changed') {
        return {
          ...state,
          routes: {
            dashboard: {
              ...route,
              actionCentre: actionCentreScopeState(
                route.actionCentre,
                action.value
              ),
            },
          },
        };
      }
      if (action.type === 'action-centre/counts-loaded') {
        return {
          ...state,
          routes: {
            dashboard: {
              ...route,
              actionCentre: {
                ...route.actionCentre,
                counts: action.counts,
                peeks: action.peeks,
                headline: action.headline,
              },
            },
          },
        };
      }
      if (action.type === 'action-centre/group-toggled') {
        const expanded = new Set(route.actionCentre.expanded);
        if (expanded.has(action.reasonId)) expanded.delete(action.reasonId);
        else expanded.add(action.reasonId);
        return {
          ...state,
          routes: {
            dashboard: {
              ...route,
              actionCentre: { ...route.actionCentre, expanded },
            },
          },
        };
      }
      if (action.type === 'action-centre/page-loaded') {
        const existing =
          action.skip === 0
            ? []
            : (route.actionCentre.pages[action.reasonId] ?? []);
        const rows = [...existing, ...action.rows];
        return {
          ...state,
          routes: {
            dashboard: {
              ...route,
              actionCentre: {
                ...route.actionCentre,
                pages: {
                  ...route.actionCentre.pages,
                  [action.reasonId]: rows,
                },
                counts: action.exhausted
                  ? {
                      ...route.actionCentre.counts,
                      [action.reasonId]: rows.length,
                    }
                  : route.actionCentre.counts,
              },
            },
          },
        };
      }
      const responsibleParty = reduceResponsibleParty(
        route.responsibleParty,
        action
      );
      if (responsibleParty !== route.responsibleParty) {
        return {
          ...state,
          routes: { dashboard: { ...route, responsibleParty } },
        };
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
      const client = tools.context.client;
      const currentUser = tools.context.chrome.currentUser;
      const capabilities = tools.context.chrome.permissions;

      if (client) {
        if (capabilities.ownedCaseTypes.length > 0) {
          void loadOwnerSummary({
            client,
            ownedCaseTypes: capabilities.ownedCaseTypes,
            allCaseSources: tools.context.caseSources,
          }).then((summaries) => {
            if (tools.isActive()) {
              tools.dispatch({ type: 'owner-summaries/loaded', summaries });
            }
          });
        }
        void loadKpis({
          client,
          currentUserId: currentUser.id,
          capabilities,
          caseSources: tools.context.caseSources,
          allCaseSources: tools.context.caseSources,
        }).then((lanes) => {
          if (tools.isActive()) tools.dispatch({ type: 'kpis/loaded', lanes });
        });
        if (capabilities.isControls) {
          void loadAppeals(client, tools.context.caseSources).then((cases) => {
            if (tools.isActive())
              tools.dispatch({ type: 'appeals/loaded', cases });
          });
        }
        void refreshReviewerCases();
        if (capabilities.isAdviser) {
          void listAcrossSources(client, tools.context.caseSources, {
            responsibleParty: currentUser.id,
          }).then((cases) => {
            if (tools.isActive()) {
              tools.dispatch({ type: 'responsible-party/loaded', cases });
            }
          });
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
      };
    },
  };
}
