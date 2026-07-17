// @ts-check
import { signal } from '../lib/signal.js';
import { reactive } from '../lib/view.js';
import { h } from '../lib/html.js';
import { trackAsyncTasks } from '../lib/async-tasks.js';
import { parseTeamCasesParams } from '../services/team-cases-params.js';
import { fetchTeamCases } from '../services/team-cases-fetcher.js';
import { caseRouteFor } from '../lib/case-route-links.js';
import { defaultCaseColumns } from '../components/collections/cora-case-table.js';
import {
  loadCaseTypeConfig,
  UnknownCaseTypeError,
} from '../../case-types/manifest.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../components/base/cora-data-table.js').ColumnDef<CaseRow>} CaseColumn */

/**
 * Resolve the `dashboardColumns` a single Case Type contributes to this table.
 *
 * Mixed-Case-Type semantics (see the `dashboardColumns` JSDoc on
 * `CaseTypeConfig`): only a table filtered to one Case Type gets that type's
 * extra columns, so a null/absent `caseType` filter — the fan-out across all
 * eligible Case Types — resolves to null. An unknown slug also resolves to
 * null: the table falls back to the default columns rather than breaking the
 * report.
 *
 * @param {string | null} caseType — the single Case Type the table is filtered
 * to, or null for a mixed multi-Case-Type view
 * @param {(slug: string) => Promise<import('../sharepoint-client.js').CaseTypeConfig>} [load]
 * @returns {Promise<CaseColumn[] | null>}
 */
export async function resolveDashboardColumns(
  caseType,
  load = loadCaseTypeConfig
) {
  if (!caseType) return null;
  try {
    const config = await load(caseType);
    return config.dashboardColumns ?? null;
  } catch (error) {
    if (error instanceof UnknownCaseTypeError) return null;
    throw error;
  }
}

/** @typedef {import('../setup/resolve-eligible-case-types.js').CaseSource} CaseSource */

/**
 * @param {{
 * client: SharePointClient|null,
 * currentUser: CurrentUser|null,
 * caseSources: CaseSource[],
 * queryString: string,
 * }} props
 * @returns {HTMLElement}
 */
export function TeamCasesPage({
  client,
  currentUser,
  caseSources,
  queryString,
}) {
  /** @type {import('../lib/signal.js').Signal<CaseRow[] | null>} */
  const cases = signal(/** @type {CaseRow[] | null} */ (null));
  // Extra columns contributed by a single Case Type's `dashboardColumns`.
  // Mixed-Case-Type views (no `caseType` filter) never populate this.
  /** @type {import('../lib/signal.js').Signal<CaseColumn[] | null>} */
  const dashboardColumns = signal(/** @type {CaseColumn[] | null} */ (null));

  async function fetchData() {
    if (!client || !currentUser) return;
    const params = parseTeamCasesParams(queryString);
    const result = await fetchTeamCases(
      client,
      params,
      currentUser.id,
      caseSources
    );
    cases.set(result);
    dashboardColumns.set(await resolveDashboardColumns(params.caseType));
  }

  const host = reactive(() =>
    renderTeamCases({
      client,
      currentUser,
      cases: cases.get(),
      dashboardColumns: dashboardColumns.get(),
    })
  );
  trackAsyncTasks(host)(fetchData());
  return host;
}

/**
 * @param {{
 * client: SharePointClient|null,
 * currentUser: CurrentUser|null,
 * cases: CaseRow[] | null,
 * dashboardColumns: CaseColumn[] | null,
 * }} props
 * @returns {Node[]}
 */
function renderTeamCases({ client, currentUser, cases, dashboardColumns }) {
  const h1 = h('h1', {}, 'Team Cases');
  const back = h('a', { href: '#/reports' }, '← Back to Reports');

  if (!client || !currentUser || !cases) {
    return [h1, back];
  }

  if (cases.length === 0) {
    return [h1, back, h('p', {}, 'No cases match the selected filters.')];
  }

  /** @type {{ cases: CaseRow[], toolbar: string, columns?: CaseColumn[] }} */
  const tableProps = { cases: cases, toolbar: 'hidden' };
  if (dashboardColumns && dashboardColumns.length > 0) {
    tableProps.columns = [
      ...defaultCaseColumns((row) => {
        location.hash = caseRouteFor(row);
      }),
      ...dashboardColumns,
    ];
  }

  return [h1, back, h('cora-case-table', tableProps)];
}
