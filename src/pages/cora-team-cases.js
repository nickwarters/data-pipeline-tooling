// @ts-check
import { signal } from '../lib/signal.js';
import { reactive } from '../lib/view.js';
import { h } from '../lib/html.js';
import { parseTeamCasesParams } from '../services/team-cases-params.js';
import { fetchTeamCases } from '../services/team-cases-fetcher.js';
import '../components/collections/cora-case-table.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/**
 * @param {{
 *   client: SharePointClient|null,
 *   currentUser: CurrentUser|null,
 *   eligibleCaseTypes: string[],
 *   queryString: string,
 * }} props
 * @returns {HTMLElement}
 */
export function TeamCasesPage({
  client,
  currentUser,
  eligibleCaseTypes,
  queryString,
}) {
  /** @type {import('../lib/signal.js').Signal<CaseRow[] | null>} */
  const cases = signal(/** @type {CaseRow[] | null} */ (null));

  async function fetchData() {
    if (!client || !currentUser) return;
    const params = parseTeamCasesParams(queryString);
    const result = await fetchTeamCases(
      client,
      params,
      currentUser.id,
      eligibleCaseTypes
    );
    cases.set(result);
  }

  const host = reactive(() =>
    renderTeamCases({ client, currentUser, cases: cases.get() })
  );
  fetchData();
  return host;
}

/**
 * @param {{
 *   client: SharePointClient|null,
 *   currentUser: CurrentUser|null,
 *   cases: CaseRow[] | null,
 * }} props
 * @returns {Node[]}
 */
function renderTeamCases({ client, currentUser, cases }) {
  const h1 = h('h1', {}, 'Team Cases');
  const back = h('a', { href: '#/reports' }, '← Back to Reports');

  if (!client || !currentUser || !cases) {
    return [h1, back];
  }

  if (cases.length === 0) {
    return [h1, back, h('p', {}, 'No cases match the selected filters.')];
  }

  return [h1, back, h('cora-case-table', { cases: cases, toolbar: 'hidden' })];
}
