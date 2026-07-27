// @ts-check
import {
  buildTeamWorkload,
  withReviewerDisplayNames,
} from '../evaluators/team-workload-model.js';
import { h } from '../lib/html.js';
import { patchRoute } from '../core/route-state.js';
import { withAbortSignal } from '../services/abortable-client.js';
import { fetchTeamWorkloadCases } from '../services/team-cases-fetcher.js';
import {
  dataTableView,
  reduceTableSort,
  sortRequested,
} from '../views/data-table.js';

/** The one table name this page sorts by: used by both the view and the reducer. */
const TABLE = 'workload';

/** @typedef {import('../evaluators/team-workload-model.js').WorkloadRow} WorkloadRow */
/** @typedef {import('../setup/resolve-eligible-case-types.js').CaseSource} CaseSource */
/** @typedef {import('../views/data-table.js').ColumnDescriptor<WorkloadRow>} WorkloadColumn */
/** @typedef {import('../views/data-table.js').TableSort} TableSort */

/**
 * @typedef {Object} MyTeamRouteState
 * @property {WorkloadRow[] | null} rows
 * @property {TableSort | null} sort
 * @property {boolean} loading
 * @property {string | null} error
 */

/**
 * @typedef {Object} MyTeamState
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {{ myTeam: MyTeamRouteState }} routes
 */

/**
 * @typedef {
 *   | { type: 'workload/refresh-requested' }
 *   | { type: 'workload/loaded', rows: WorkloadRow[] }
 *   | { type: 'workload/load-failed', message: string }
 *   | { type: 'workload-table/sort-requested', key: string }
 * } MyTeamAction
 */

/**
 * @param {CaseSource[]} sources
 * @returns {WorkloadColumn[]}
 */
export function myTeamColumns(sources) {
  return [
    {
      key: 'reviewer',
      label: 'Reviewer',
      value: 'reviewer',
      sortable: true,
    },
    ...sources.map((source) => ({
      key: `case-type-${source.slug}`,
      label: source.displayName || source.slug,
      value: (/** @type {WorkloadRow} */ row) =>
        row.countsByCaseType[source.slug] ?? 0,
      sortable: true,
    })),
    {
      key: 'totalOutstanding',
      label: 'Total outstanding',
      value: 'totalOutstanding',
      sortable: true,
    },
    {
      key: 'onHold',
      label: 'On hold',
      value: 'onHold',
      sortable: true,
    },
    {
      key: 'longestHoldDays',
      label: 'Longest hold (days)',
      value: 'longestHoldDays',
      sortable: true,
    },
  ];
}

/**
 * @param {MyTeamState} state
 * @param {{
 *   dispatch: (action: MyTeamAction) => void,
 *   caseSources: CaseSource[],
 *   runRefreshEffect?: () => void,
 * }} tools
 * @returns {HTMLElement}
 */
export function myTeamView(
  state,
  { dispatch, caseSources, runRefreshEffect = () => {} }
) {
  const route = state.routes.myTeam;
  const staffRows = route.rows?.filter((row) => !row.isTotal) ?? [];
  const totalRows = route.rows?.filter((row) => row.isTotal) ?? [];
  return h(
    'main',
    { className: 'cora-my-team', 'aria-busy': String(route.loading) },
    h(
      'header',
      { className: 'cora-my-team-header' },
      h(
        'div',
        {},
        h('h1', {}, 'My Team'),
        h(
          'p',
          {},
          'A live view of allocated, outstanding Cases across your team.'
        )
      ),
      h(
        'button',
        {
          type: 'button',
          disabled: route.loading,
          onclick: () => {
            dispatch({ type: 'workload/refresh-requested' });
            runRefreshEffect();
          },
        },
        route.loading ? 'Refreshing…' : 'Refresh'
      )
    ),
    h('h2', {}, 'Current Workload'),
    h(
      'p',
      { className: 'cora-my-team-roster-note' },
      'This v1 view shows only staff with allocated outstanding Cases because no separate staff roster is available.'
    ),
    route.error ? h('p', { role: 'alert' }, route.error) : null,
    route.loading && route.rows === null
      ? h('p', {}, 'Loading current workload…')
      : null,
    route.rows !== null
      ? h(
          'div',
          { className: 'cora-my-team-table' },
          dataTableView({
            rows: staffRows,
            footerRows: totalRows,
            columns: myTeamColumns(caseSources),
            sort: route.sort,
            onSort: (key) => dispatch(sortRequested(TABLE, key)),
            emptyMessage: 'No allocated outstanding Cases.',
            rowKey: (row) =>
              row.reviewerId === null
                ? 'workload-total'
                : `reviewer:${row.reviewerId}`,
            rowClass: (row) =>
              row.isTotal ? 'cora-workload-row cora-workload-row--total' : '',
          })
        )
      : null
  );
}

/**
 * @param {Record<string, string>} _params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {{
 *   fetchCases?: typeof fetchTeamWorkloadCases,
 *   now?: () => Date,
 * }} [dependencies]
 */
export function createRouteSlice(
  _params,
  context,
  { fetchCases = fetchTeamWorkloadCases, now = () => new Date() } = {}
) {
  let loadSequence = 0;
  // The mount lifetime comes from the adapter's tools, not a page-local latch (#517).
  /** @type {null | { dispatch: (action: MyTeamAction) => void, context: import('../setup/register-routes.js').AppContext, isActive: () => boolean, signal?: AbortSignal }} */
  let effectTools = null;
  // The same lifetime bound to the client's reads, so navigating away cancels
  // the per-source workload fan-out rather than only discarding it (#545).
  /** @type {null | import('../sharepoint-client.js').SharePointClient} */
  let readClient = null;

  function runRefreshEffect() {
    const tools = effectTools;
    if (!tools || !tools.isActive()) return;
    const sequence = ++loadSequence;
    void fetchCases(
      // `readClient` and `effectTools` are set and cleared together, so this is
      // the single source; the cast covers the client-less mount, which reaches
      // the rejection handler below exactly as it did before #545.
      /** @type {import('../sharepoint-client.js').SharePointClient} */ (
        readClient
      ),
      tools.context.chrome.currentUser.id,
      tools.context.caseSources
    ).then(
      async (cases) => {
        if (!tools.isActive() || sequence !== loadSequence) return;
        const rows = buildTeamWorkload(cases, tools.context.caseSources, now());
        const reviewerIds = rows.flatMap((row) =>
          row.reviewerId === null ? [] : [row.reviewerId]
        );
        /** @type {Record<string, string | null>} */
        let displayNames = {};
        try {
          if (typeof tools.context.client.resolveUsers === 'function') {
            displayNames = await tools.context.client.resolveUsers(reviewerIds);
          }
        } catch {
          // Workload data remains useful when directory enrichment is unavailable.
        }
        if (tools.isActive() && sequence === loadSequence) {
          tools.dispatch({
            type: 'workload/loaded',
            rows: withReviewerDisplayNames(rows, displayNames),
          });
        }
      },
      (error) => {
        // An abort reaches here with isActive() already false, so navigation
        // never renders a load failure (#545).
        if (tools.isActive() && sequence === loadSequence) {
          tools.dispatch({
            type: 'workload/load-failed',
            message:
              error instanceof Error
                ? error.message
                : 'Unable to load current workload.',
          });
        }
      }
    );
  }

  /** @type {MyTeamState} */
  const initialState = {
    chrome: context.chrome,
    routes: {
      myTeam: {
        rows: null,
        sort: null,
        loading: true,
        error: null,
      },
    },
  };

  return {
    initialState,
    /**
     * @param {MyTeamState} state
     * @param {MyTeamAction} action
     * @returns {MyTeamState}
     */
    reducer(state, action) {
      const route = state.routes.myTeam;
      if (action.type === 'workload/refresh-requested') {
        return patchRoute(state, 'myTeam', { loading: true, error: null });
      }
      if (action.type === 'workload/loaded') {
        return patchRoute(state, 'myTeam', {
          rows: action.rows,
          loading: false,
          error: null,
        });
      }
      if (action.type === 'workload/load-failed') {
        return patchRoute(state, 'myTeam', {
          loading: false,
          error: action.message,
        });
      }
      const sort = reduceTableSort(route.sort, action, TABLE);
      if (sort) return patchRoute(state, 'myTeam', { sort });
      return state;
    },
    view(
      /** @type {MyTeamState} */ state,
      /** @type {{ dispatch: (action: MyTeamAction) => void, context: import('../setup/register-routes.js').AppContext }} */ tools
    ) {
      return myTeamView(state, {
        dispatch: tools.dispatch,
        caseSources: tools.context.caseSources,
        runRefreshEffect,
      });
    },
    start(
      /** @type {{ dispatch: (action: MyTeamAction) => void, context: import('../setup/register-routes.js').AppContext, isActive: () => boolean, signal?: AbortSignal }} */ tools
    ) {
      effectTools = tools;
      // Only wrap when there is something to wrap: a mount with no client must
      // still degrade to the `workload/load-failed` message rather than let
      // binding the mount signal take out the whole route (#545).
      readClient = tools.context.client
        ? withAbortSignal(tools.context.client, tools.signal)
        : tools.context.client;
      tools.dispatch({ type: 'workload/refresh-requested' });
      runRefreshEffect();

      return () => {
        effectTools = null;
        readClient = null;
        loadSequence += 1;
      };
    },
  };
}
