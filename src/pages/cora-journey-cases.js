// @ts-check
import { h } from '../lib/html.js';
import { caseRouteFor } from '../lib/case-route-links.js';
import { fetchJourneyCases } from '../services/journey-cases-fetcher.js';
import { dataTableView, nextTableSort } from '../views/data-table.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/**
 * @typedef {Object} JourneyCasesState
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {{ journeyCases: { cases: CaseRow[] | null, sort: import('../views/data-table.js').TableSort | null } }} routes
 */

/** @returns {import('../views/data-table.js').ColumnDescriptor<CaseRow>[]} */
export function journeyCasesColumns() {
  return [
    {
      key: 'reference',
      label: 'Reference',
      value: (row) => row.title || row.id,
      sortable: true,
      href: caseRouteFor,
    },
    {
      key: 'caseType',
      label: 'Case Type',
      value: 'caseType',
      sortable: true,
    },
    {
      key: 'status',
      label: 'Status',
      value: 'status',
      sortable: true,
    },
  ];
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
      onSort: (key) => tools.dispatch({ type: 'table/sort-requested', key }),
      emptyMessage: 'No cases of your Case Type(s) yet.',
      rowKey: (row) => `${row.caseType}:${row.id}`,
      rowHref: caseRouteFor,
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
        return {
          ...state,
          routes: { journeyCases: { ...route, cases: action.cases } },
        };
      }
      if (action.type === 'table/sort-requested') {
        return {
          ...state,
          routes: {
            journeyCases: {
              ...route,
              sort: nextTableSort(route.sort, action.key),
            },
          },
        };
      }
      return state;
    },
    view: journeyCasesView,
    start(/** @type {any} */ tools) {
      let active = true;
      if (!tools.context.client) return () => {};
      void fetchCases(
        tools.context.client,
        tools.context.journeyCaseSources
      ).then((cases) => {
        if (active) tools.dispatch({ type: 'cases/loaded', cases });
      });
      return () => {
        active = false;
      };
    },
  };
}
