// @ts-check
import { h } from '../lib/html.js';
import { patchRoute } from '../core/route-state.js';
import { ignoreAbortError } from '../lib/abort.js';
import { withAbortSignal } from '../services/abortable-client.js';
import { caseRouteFor } from '../lib/case-route-links.js';
import { navigateTo } from '../lib/navigate.js';
import { fetchTeamCases } from '../services/team-cases-fetcher.js';
import { parseTeamCasesParams } from '../services/team-cases-params.js';
import {
  overdueCaseRowClass,
  standardCaseColumns,
} from '../views/case-columns.js';
import {
  dataTableView,
  reduceTableSort,
  sortRequested,
} from '../views/data-table.js';

/** The one table name this page sorts by: used by both the view and the reducer. */
const TABLE = 'team';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../views/data-table.js').ColumnDescriptor<CaseRow>} CaseColumnDescriptor */
/** @typedef {import('../views/data-table.js').TableSort} TableSort */

/**
 * @typedef {Object} TeamCasesRouteState
 * @property {CaseRow[] | null} cases
 * @property {TableSort | null} sort
 */

/**
 * @typedef {Object} TeamCasesState
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {{ teamCases: TeamCasesRouteState }} routes
 */

/**
 * @param {TeamCasesState} state
 * @param {{ dispatch: (action: any) => any }} tools
 * @returns {HTMLElement}
 */
export function teamCasesView(state, tools) {
  const route = state.routes.teamCases;
  const heading = h('h1', {}, 'Team Cases');
  if (!route.cases) return h('div', {}, heading);

  return h(
    'div',
    {},
    heading,
    dataTableView({
      rows: route.cases,
      columns: standardCaseColumns({
        onOpen: (row) => navigateTo(caseRouteFor(row)),
      }),
      sort: route.sort,
      onSort: (key) => tools.dispatch(sortRequested(TABLE, key)),
      emptyMessage: 'No cases match the selected filters.',
      rowKey: (row) => `${row.caseType}:${row.id}`,
      rowHref: caseRouteFor,
      rowClass: overdueCaseRowClass,
    })
  );
}

/**
 * @param {Record<string, string>} _params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {{ fetchCases?: typeof fetchTeamCases }} [dependencies]
 * @returns {{
 *   initialState: TeamCasesState,
 *   reducer: (state: TeamCasesState, action: any) => TeamCasesState,
 *   view: typeof teamCasesView,
 *   start: (tools: { dispatch: (action: any) => any, params: Record<string, string>, context: import('../setup/register-routes.js').AppContext, isActive: () => boolean, signal?: AbortSignal }) => void,
 * }}
 */
export function createRouteSlice(
  _params,
  context,
  { fetchCases = fetchTeamCases } = {}
) {
  return {
    initialState: {
      chrome: context.chrome,
      routes: {
        teamCases: {
          cases: null,
          sort: null,
        },
      },
    },
    reducer(state, action) {
      const route = state.routes.teamCases;
      if (action.type === 'cases/loaded') {
        return patchRoute(state, 'teamCases', { cases: action.cases });
      }
      const sort = reduceTableSort(route.sort, action, TABLE);
      if (sort) return patchRoute(state, 'teamCases', { sort });
      return state;
    },
    view: teamCasesView,
    start(tools) {
      const client = tools.context.client;
      const currentUser = tools.context.chrome.currentUser;
      if (!client || !currentUser) return;

      // The router supplies params.queryString for every route — '' when the
      // hash has no query, so there is nothing to fall back to.
      const parsed = parseTeamCasesParams(tools.params.queryString);
      // The signal cancels the per-source fan-out on navigation; the
      // isActive() guard still stops a late dispatch.
      const readClient = withAbortSignal(client, tools.signal);
      void fetchCases(
        readClient,
        parsed,
        currentUser.id,
        tools.context.caseSources
      )
        .then((cases) => {
          if (tools.isActive()) {
            tools.dispatch({ type: 'cases/loaded', cases });
          }
        })
        .catch(ignoreAbortError);
    },
  };
}
