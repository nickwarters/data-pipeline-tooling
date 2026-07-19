// @ts-check
import { h } from '../lib/html.js';
import { caseRouteFor } from '../lib/case-route-links.js';
import '../components/sections/cora-allocation.js';
import '../components/sections/cora-owner-summary.js';
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
 * @property {TableSort | null} appealSort
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
    { key: 'status', label: 'Status', value: 'status', sortable: true },
    {
      key: 'dueDate',
      label: 'Due Date',
      value: (row) => row.dueDate || '',
      sortable: true,
      format: (value) =>
        value ? new Date(String(value)).toLocaleDateString() : '—',
    },
  ];
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
    ownerSummary: () =>
      h('cora-owner-summary', {
        client: tools.context.client,
        ownedCaseTypes: capabilities.ownedCaseTypes,
        allCaseSources: tools.context.caseSources,
      }),
    reviewerCases: () =>
      h(
        'section',
        { className: 'cora-reviewer-cases' },
        h('h1', {}, 'Outstanding Cases'),
        dataTableView({
          rows: route.reviewerCases,
          columns: reviewerCaseColumns(),
          sort: route.reviewerSort,
          onSort: (key) =>
            tools.dispatch({ type: 'reviewer-table/sort-requested', key }),
          emptyMessage: 'No outstanding cases.',
          rowKey: (row) => `${row.caseType}:${row.id}`,
          rowHref: caseRouteFor,
          rowClass: (row) =>
            row.overdue
              ? 'cora-case-row cora-case-row--overdue'
              : 'cora-case-row',
        })
      ),
    allocation: () =>
      h('cora-allocation', {
        client: tools.context.client,
        currentUserId: state.chrome.currentUser.id,
        allocationSources: tools.context.allocationSources,
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
        appealSort: { key: 'raised', dir: 'asc' },
        actionCentre: initialActionCentreState(context.chrome.permissions),
        responsibleParty: initialResponsiblePartyState(
          context.chrome.currentUser.id
        ),
      },
    },
  };

  /** @type {any} */
  let effectTools = null;
  let effectsActive = false;

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
    if (effectsActive) {
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
    if (effectsActive) {
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
      const next = {
        ...actionState,
        needsActionNow: value,
        reasons: visibleReasons(actionState.allReasons, value),
        pages: {},
      };
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
              actionCentre: {
                ...route.actionCentre,
                needsActionNow: action.value,
                reasons: visibleReasons(
                  route.actionCentre.allReasons,
                  action.value
                ),
                counts: {},
                peeks: {},
                headline: 0,
                pages: {},
              },
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
      dashboardView(state, { ...tools, actionCentreActions }),
    start(/** @type {any} */ tools) {
      let active = true;
      effectTools = tools;
      effectsActive = true;
      const client = tools.context.client;
      const currentUser = tools.context.chrome.currentUser;
      const capabilities = tools.context.chrome.permissions;

      const loadReviewerCases = async () => {
        if (!client || !capabilities.isReviewer) return;
        const rows = await listAcrossSources(
          client,
          tools.context.caseSources,
          {
            status: CASE_STATUS.IN_PROGRESS,
            assignedReviewer: currentUser.id,
          }
        );
        if (active) {
          tools.dispatch({
            type: 'reviewer-cases/loaded',
            cases: rows.map((row) => ({ ...row, overdue: isOverdue(row) })),
          });
        }
      };

      if (client) {
        void loadKpis({
          client,
          currentUserId: currentUser.id,
          capabilities,
          caseSources: tools.context.caseSources,
          allCaseSources: tools.context.caseSources,
        }).then((lanes) => {
          if (active) tools.dispatch({ type: 'kpis/loaded', lanes });
        });
        if (capabilities.isControls) {
          void loadAppeals(client, tools.context.caseSources).then((cases) => {
            if (active) tools.dispatch({ type: 'appeals/loaded', cases });
          });
        }
        void loadReviewerCases();
        if (capabilities.isAdviser) {
          void listAcrossSources(client, tools.context.caseSources, {
            responsibleParty: currentUser.id,
          }).then((cases) => {
            if (active) {
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
            if (!active || !first) return;
            tools.dispatch({
              type: 'action-centre/group-toggled',
              reasonId: first.id,
            });
            void refreshActionPage(actionState, first, 0);
          });
        }
      }

      if (capabilities.isReviewer && tools.context.appEl) {
        tools.listen(tools.context.appEl, 'cora-allocated', () => {
          void loadReviewerCases();
        });
      }
      return () => {
        active = false;
        effectsActive = false;
        effectTools = null;
      };
    },
  };
}
