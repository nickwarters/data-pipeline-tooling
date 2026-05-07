// @ts-check
import { CRElement } from './cr-element.js';

/** @typedef {import('./sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('./sharepoint-client.js').CaseRow} CaseRow */

export class CRDashboard extends CRElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {string} */
    this.currentUserId = '';
  }

  async connectedCallback() {
    if (!this.client) return;
    const cases = await this.client.listCases({
      status: 'In-progress',
      assignedReviewer: this.currentUserId,
    });
    this._render(cases);
  }

  /** @param {CaseRow[]} cases */
  _render(cases) {
    const h1 = document.createElement('h1');
    h1.textContent = 'Outstanding Cases';

    if (cases.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No outstanding cases.';
      this.replaceChildren(h1, p);
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'cr-case-list';

    for (const c of cases) {
      const li = document.createElement('li');
      li.className = 'cr-case-row';
      const a = document.createElement('a');
      a.href = `#/case/${c.id}`;
      a.textContent = `${c.title} (${c.caseType})`;
      li.appendChild(a);
      ul.appendChild(li);
    }

    this.replaceChildren(h1, ul);
  }
}

customElements.define('cr-dashboard', CRDashboard);
