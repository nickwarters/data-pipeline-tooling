// @ts-check
import { h } from '../lib/html.js';
import { patchRoute } from '../core/route-state.js';
import { caseRouteFor } from '../lib/case-route-links.js';
import { fetchTeamCases } from '../services/team-cases-fetcher.js';
import { parseTeamCasesParams } from '../services/team-cases-params.js';
import {
  dataTableView,
  reduceTableSort,
  sortRequested,
} from '../views/data-table.js';
import {
  loadCaseTypeConfig,
  UnknownCaseTypeError,
} from '../../case-types/manifest.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../views/data-table.js').ColumnDescriptor<CaseRow>} CaseColumnDescriptor */
/** @typedef {import('../views/data-table.js').TableSort} TableSort */

/**
 * @typedef {Object} TeamCasesRouteState
 * @property {CaseRow[] | null} cases
 * @property {CaseColumnDescriptor[]} caseTableColumns
 * @property {TableSort | null} sort
 */

/**
 * @typedef {Object} TeamCasesState
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {{ teamCases: TeamCasesRouteState }} routes
 */

/**
 * Resolve the extension columns for a table scoped to one Case Type. Mixed
 * tables and unknown Case Types keep the framework defaults.
 *
 * @param {string | null} caseType
 * @param {(slug: string) => Promise<import('../sharepoint-client.js').CaseTypeConfig>} [load]
 * @returns {Promise<CaseColumnDescriptor[]>}
 */
export async function resolveDashboardColumns(
  caseType,
  load = loadCaseTypeConfig
) {
  if (!caseType) return [];
  try {
    const config = await load(caseType);
    return config.caseTableColumns ?? [];
  } catch (error) {
    if (error instanceof UnknownCaseTypeError) return [];
    throw error;
  }
}

/**
 * Team Cases is the first real page to declare the generic table's variation.
 * Value selection and presentation remain declarative; the Actions cell keeps
 * its navigation behaviour in code.
 *
 * @param {CaseColumnDescriptor[]} [caseTableColumns]
 * @returns {CaseColumnDescriptor[]}
 */
export function teamCasesColumns(caseTableColumns = []) {
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
    {
      key: 'status',
      label: 'Status',
      value: 'status',
      sortable: true,
    },
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
    ...caseTableColumns,
  ];
}

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
      columns: teamCasesColumns(route.caseTableColumns),
      sort: route.sort,
      onSort: (key) => tools.dispatch(sortRequested('team', key)),
      emptyMessage: 'No cases match the selected filters.',
      rowKey: (row) => `${row.caseType}:${row.id}`,
      rowHref: caseRouteFor,
      rowClass: (row) =>
        row.overdue ? 'cora-case-row cora-case-row--overdue' : 'cora-case-row',
    })
  );
}

/**
 * @param {Record<string, string>} params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {{
 *   fetchCases?: typeof fetchTeamCases,
 *   resolveColumns?: typeof resolveDashboardColumns,
 * }} [dependencies]
 * @returns {{
 *   initialState: TeamCasesState,
 *   reducer: (state: TeamCasesState, action: any) => TeamCasesState,
 *   view: typeof teamCasesView,
 *   start: (tools: { dispatch: (action: any) => any, params: Record<string, string>, context: import('../setup/register-routes.js').AppContext, isActive: () => boolean }) => void,
 * }}
 */
export function createRouteSlice(
  params,
  context,
  { fetchCases = fetchTeamCases, resolveColumns = resolveDashboardColumns } = {}
) {
  return {
    initialState: {
      chrome: context.chrome,
      routes: {
        teamCases: {
          cases: null,
          caseTableColumns: [],
          sort: null,
        },
      },
    },
    reducer(state, action) {
      const route = state.routes.teamCases;
      if (action.type === 'cases/loaded') {
        return patchRoute(state, 'teamCases', {
          cases: action.cases,
          caseTableColumns: action.caseTableColumns,
        });
      }
      const sort = reduceTableSort(route.sort, action, 'team');
      if (sort) return patchRoute(state, 'teamCases', { sort });
      return state;
    },
    view: teamCasesView,
    start(tools) {
      const client = tools.context.client;
      const currentUser = tools.context.chrome.currentUser;
      if (!client || !currentUser) return;

      const parsed = parseTeamCasesParams(
        tools.params.queryString ?? params.queryString ?? ''
      );
      void Promise.all([
        fetchCases(client, parsed, currentUser.id, tools.context.caseSources),
        resolveColumns(parsed.caseType),
      ]).then(([cases, caseTableColumns]) => {
        if (tools.isActive()) {
          tools.dispatch({ type: 'cases/loaded', cases, caseTableColumns });
        }
      });
    },
  };
}
