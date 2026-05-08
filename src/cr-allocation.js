// @ts-check
import { CRElement } from './cr-element.js';

/** @typedef {import('./sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('./sharepoint-client.js').CaseRow} CaseRow */

export class CRAllocation extends CRElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {string} */
    this.currentUserId = '';
    /** @type {string[]} */
    this.eligibleCaseTypes = [];
  }

  connectedCallback() {
    this._render();
  }

  _render() {
    const btn = document.createElement('button');
    btn.textContent = 'Request next Case';
    btn.className = 'cr-allocation-btn';
    btn.addEventListener('click', () => this._requestNextCase());
    this.replaceChildren(btn);
  }

  /** @returns {Promise<void>} */
  async _requestNextCase() {
    if (!this.client) return;
    const candidates = await this._getUnassignedCases();
    for (const c of candidates) {
      const result = await this.client.patchCase(c.id, { assignedReviewer: this.currentUserId }, c.etag);
      if (result.ok) {
        location.hash = `#/case/${c.id}`;
        return;
      }
      // 412 — another reviewer won the race; try the next candidate
    }
    this._renderEmpty();
  }

  /** @returns {Promise<CaseRow[]>} */
  async _getUnassignedCases() {
    if (!this.client) return [];
    const all = await this.client.listCases({ status: 'In-progress' });
    return all
      .filter(c => c.assignedReviewer === '' && this.eligibleCaseTypes.includes(c.caseType))
      .sort((a, b) => (a.created ?? '') < (b.created ?? '') ? -1 : 1);
  }

  _renderEmpty() {
    const p = document.createElement('p');
    p.textContent = 'No Cases available';
    p.className = 'cr-allocation-empty';
    this.replaceChildren(p);
  }
}

customElements.define('cr-allocation', CRAllocation);
