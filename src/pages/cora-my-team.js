// @ts-check
import { buildTeamWorkload } from '../evaluators/team-workload-model.js';
import { h } from '../lib/html.js';
import { fetchTeamWorkloadCases } from '../services/team-cases-fetcher.js';
import { dataTableView, nextTableSort } from '../views/data-table.js';

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
 * @property {CaseSource[]} myTeamCaseSources
 * @property {{ myTeam: MyTeamRouteState }} routes
 */

/**
 * @typedef {
 *   | { type: 'workload/load-started' }
 *   | { type: 'workload/loaded', rows: WorkloadRow[] }
 *   | { type: 'workload/load-failed', message: string }
 *   | { type: 'table/sort-requested', key: string }
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
 * @param {{ dispatch: (action: MyTeamAction) => void, onRefresh: () => void }} tools
 * @returns {HTMLElement}
 */
export function myTeamView(state, { dispatch, onRefresh }) {
  const route = state.routes.myTeam;
  return h(
    'main',
    { class: 'cora-my-team', 'aria-busy': String(route.loading) },
    h(
      'header',
      { class: 'cora-my-team-header' },
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
          onclick: onRefresh,
        },
        route.loading ? 'Refreshing…' : 'Refresh'
      )
    ),
    h('h2', {}, 'Current Workload'),
    h(
      'p',
      { class: 'cora-my-team-roster-note' },
      'This v1 view shows only staff with allocated outstanding Cases because no separate staff roster is available.'
    ),
    route.error ? h('p', { role: 'alert' }, route.error) : null,
    route.loading && route.rows === null
      ? h('p', {}, 'Loading current workload…')
      : null,
    route.rows !== null
      ? h(
          'div',
          { class: 'cora-my-team-table' },
          dataTableView({
            rows: route.rows,
            columns: myTeamColumns(state.myTeamCaseSources),
            sort: route.sort,
            onSort: (key) => dispatch({ type: 'table/sort-requested', key }),
            emptyMessage: 'No allocated outstanding Cases.',
            rowKey: (row) => (row.isTotal ? 'total' : row.reviewer),
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
  let active = false;
  let loadSequence = 0;
  /** @type {() => void} */
  let refresh = () => {};

  /** @type {MyTeamState} */
  const initialState = {
    chrome: context.chrome,
    myTeamCaseSources: context.caseSources,
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
      if (action.type === 'workload/load-started') {
        return {
          ...state,
          routes: {
            myTeam: { ...route, loading: true, error: null },
          },
        };
      }
      if (action.type === 'workload/loaded') {
        return {
          ...state,
          routes: {
            myTeam: {
              ...route,
              rows: action.rows,
              loading: false,
              error: null,
            },
          },
        };
      }
      if (action.type === 'workload/load-failed') {
        return {
          ...state,
          routes: {
            myTeam: {
              ...route,
              loading: false,
              error: action.message,
            },
          },
        };
      }
      if (action.type === 'table/sort-requested') {
        return {
          ...state,
          routes: {
            myTeam: {
              ...route,
              sort: nextTableSort(route.sort, action.key),
            },
          },
        };
      }
      return state;
    },
    view(
      /** @type {MyTeamState} */ state,
      /** @type {{ dispatch: (action: MyTeamAction) => void }} */ tools
    ) {
      return myTeamView(state, {
        dispatch: tools.dispatch,
        onRefresh: refresh,
      });
    },
    start(
      /** @type {{ dispatch: (action: MyTeamAction) => void, context: import('../setup/register-routes.js').AppContext }} */ tools
    ) {
      active = true;
      refresh = () => {
        const sequence = ++loadSequence;
        tools.dispatch({ type: 'workload/load-started' });
        void fetchCases(
          tools.context.client,
          tools.context.chrome.currentUser.id,
          tools.context.caseSources
        ).then(
          (cases) => {
            if (active && sequence === loadSequence) {
              tools.dispatch({
                type: 'workload/loaded',
                rows: buildTeamWorkload(
                  cases,
                  tools.context.caseSources,
                  now()
                ),
              });
            }
          },
          (error) => {
            if (active && sequence === loadSequence) {
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
      };
      refresh();

      return () => {
        active = false;
        loadSequence += 1;
      };
    },
  };
}
