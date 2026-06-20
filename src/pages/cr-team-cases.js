// @ts-check
import { ReactiveElement } from '../components/reactive-element.js';
import { signal } from '../lib/signal.js';
import { h } from '../lib/html.js';
import { parseTeamCasesParams } from '../services/team-cases-params.js';
import { fetchTeamCases } from '../services/team-cases-fetcher.js';
import '../components/cr-case-table.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */

export class CRTeamCases extends ReactiveElement {
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

    /** @type {import('../lib/signal.js').Signal<import('../sharepoint-client.js').CaseRow[] | null>} */
    this._cases = signal(null);
  }

  async connectedCallback() {
    super.connectedCallback();
    await this._fetchData();
  }

  async _fetchData() {
    if (!this.client || !this.currentUser) return;
    const params = parseTeamCasesParams(this.queryString);
    const cases = await fetchTeamCases(this.client, params, this.currentUser.id, this.eligibleCaseTypes);
    this._cases.set(cases);
  }

  render() {
    const h1 = h('h1', {}, 'Team Cases');
    const back = h('a', { href: '#/reports' }, '← Back to Reports');

    const cases = this._cases.get();

    if (!this.client || !this.currentUser || !cases) {
      return [h1, back];
    }

    if (cases.length === 0) {
      return [h1, back, h('p', {}, 'No cases match the selected filters.')];
    }

    return [
      h1,
      back,
      h('cr-case-table', { cases: cases, toolbar: 'hidden' })
    ];
  }
}

customElements.define('cr-team-cases', CRTeamCases);
