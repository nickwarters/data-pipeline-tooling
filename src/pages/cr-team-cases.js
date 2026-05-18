// @ts-check
import { CRElement } from '../components/cr-element.js';
import { parseTeamCasesParams } from '../services/team-cases-params.js';
import { fetchTeamCases } from '../services/team-cases-fetcher.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */

export class CRTeamCases extends CRElement {
  constructor() {
    super();
    /** @type {SharePointClient|null} */
    this.client = null;
    /** @type {CurrentUser|null} */
    this.currentUser = null;
    /** @type {string[]} */
    this.eligibleCaseTypes = [];
    /** @type {string} */
    this.queryString = '';
  }

  async connectedCallback() {
    const h1 = document.createElement('h1');
    h1.textContent = 'Team Cases';

    const back = document.createElement('a');
    back.setAttribute('href', '#/reports');
    back.textContent = '← Back to Reports';

    if (!this.client || !this.currentUser) {
      this.replaceChildren(h1, back);
      return;
    }

    const params = parseTeamCasesParams(this.queryString);
    const cases = await fetchTeamCases(this.client, params, this.currentUser.id, this.eligibleCaseTypes);

    if (cases.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No cases match the selected filters.';
      this.replaceChildren(h1, back, empty);
      return;
    }

    const table = /** @type {import('../components/cr-case-table.js').CRCaseTable} */ (
      document.createElement('cr-case-table')
    );
    table.cases = cases;
    table.toolbar = 'hidden';
    this.replaceChildren(h1, back, table);
    /** @type {any} */ (table).connectedCallback?.();
  }
}

customElements.define('cr-team-cases', CRTeamCases);
