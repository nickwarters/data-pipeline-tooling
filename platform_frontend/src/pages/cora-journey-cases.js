// @ts-check
import { h } from '../lib/html.js';
import { patchRoute } from '../core/route-state.js';
import { ignoreAbortError } from '../lib/abort.js';
import { withAbortSignal } from '../services/abortable-client.js';
import { caseRouteFor } from '../lib/case-route-links.js';
import { fetchJourneyCases } from '../services/journey-cases-fetcher.js';
import {
  caseReferenceColumn,
  caseStatusColumn,
  caseTypeColumn,
  overdueCaseRowClass,
} from '../views/case-columns.js';
import {
  dataTableView,
  reduceTableSort,
  sortRequested,
} from '../views/data-table.js';

/** The one table name this page sorts by: used by both the view and the reducer. */
const TABLE = 'journey';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/**
 * @typedef {Object} JourneyCasesState
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {{ journeyCases: { cases: CaseRow[] | null, sort: import('../views/data-table.js').TableSort | null } }} routes
 */

/**
 * Journey Cases is the standard Case table's three-column subset: same
 * Reference link, same Case Type and Status selection.
 *
 * @returns {import('../views/data-table.js').ColumnDescriptor<CaseRow>[]}
 */
export function journeyCasesColumns() {
  return [caseReferenceColumn(), caseTypeColumn(), caseStatusColumn()];
}

/**
 * @param {JourneyCasesState} state
 * @param {{ dispatch: (action: any) => any }} tools
 */
export function journeyCasesView(state, tools) {
  const route = state.routes.journeyCases;
  const heading = h('h1', {}, 'Journey Cases');
  if (!route.cases) return h('div', {}, heading);
  return h(
    'div',
    {},
    heading,
    dataTableView({
      rows: route.cases,
      columns: journeyCasesColumns(),
      sort: route.sort,
      onSort: (key) => tools.dispatch(sortRequested(TABLE, key)),
      emptyMessage: 'No cases of your Case Type(s) yet.',
      rowKey: (row) => `${row.caseType}:${row.id}`,
      rowHref: caseRouteFor,
      // Overdue is a property of the Case, not of the viewer's role, so these
      // rows carry the same base `cora-case-row` and overdue modifier as the
      // Dashboard and Team Cases rather than a fourth spelling.
      rowClass: overdueCaseRowClass,
    })
  );
}

/**
 * @param {Record<string, string>} _params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {{ fetchCases?: typeof fetchJourneyCases }} [dependencies]
 */
export function createRouteSlice(
  _params,
  context,
  { fetchCases = fetchJourneyCases } = {}
) {
  return {
    initialState: {
      chrome: context.chrome,
      routes: { journeyCases: { cases: null, sort: null } },
    },
    reducer(/** @type {JourneyCasesState} */ state, /** @type {any} */ action) {
      const route = state.routes.journeyCases;
      if (action.type === 'cases/loaded') {
        return patchRoute(state, 'journeyCases', { cases: action.cases });
      }
      const sort = reduceTableSort(route.sort, action, TABLE);
      if (sort) return patchRoute(state, 'journeyCases', { sort });
      return state;
    },
    view: journeyCasesView,
    start(/** @type {any} */ tools) {
      if (!tools.context.client) return;
      // The signal cancels the per-source fan-out on navigation; the
      // isActive() guard still stops a late dispatch.
      const client = withAbortSignal(tools.context.client, tools.signal);
      void fetchCases(client, tools.context.journeyCaseSources)
        .then((cases) => {
          if (tools.isActive()) tools.dispatch({ type: 'cases/loaded', cases });
        })
        .catch(ignoreAbortError);
    },
  };
}
