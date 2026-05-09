// @ts-check
import { CRElement } from './cr-element.js';
import './cr-case-table.js';

/** @typedef {import('./sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('./sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('./permissions.js').Capabilities} Capabilities */
/** @typedef {import('./cr-case-table.js').CRCaseTable} CRCaseTable */

export class CRDashboard extends CRElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {string} */
    this.currentUserId = '';
    /** @type {Capabilities} */
    this.capabilities = { isReviewer: false, ownedCaseTypes: [] };
    /** @type {string[]} */
    this.eligibleCaseTypes = [];
  }

  async connectedCallback() {
    if (!this.client) return;
    /** @type {CaseRow[]} */
    let cases = [];
    if (this.capabilities.isReviewer) {
      cases = await this.client.listCases({
        status: 'In-progress',
        assignedReviewer: this.currentUserId,
      });
    }
    this._render(cases);
  }

  /** @param {CaseRow[]} cases */
  _render(cases) {
    /** @type {Element[]} */
    const children = [];

    if (this.capabilities.isReviewer) {
      const h1 = document.createElement('h1');
      h1.textContent = 'Outstanding Cases';
      children.push(h1);

      const caseTable = /** @type {CRCaseTable} */ (document.createElement('cr-case-table'));
      caseTable.cases = cases;
      caseTable.addEventListener('cr-case-open', (/** @type {any} */ e) => {
        location.hash = `#/case/${e.detail.caseId}`;
      });
      children.push(caseTable);

      const allocationEl = /** @type {import('./cr-allocation.js').CRAllocation} */ (
        document.createElement('cr-allocation')
      );
      allocationEl.client = this.client;
      allocationEl.currentUserId = this.currentUserId;
      allocationEl.eligibleCaseTypes = this.eligibleCaseTypes;
      allocationEl.addEventListener('cr-allocated', () => this.connectedCallback());
      children.push(allocationEl);
    }

    if (this.capabilities.ownedCaseTypes.length > 0) {
      const ownerSection = /** @type {import('./cr-owner-summary.js').CROwnerSummary} */ (
        document.createElement('cr-owner-summary')
      );
      ownerSection.client = this.client;
      ownerSection.ownedCaseTypes = this.capabilities.ownedCaseTypes;
      children.push(ownerSection);
    }

    this.replaceChildren(...children);
  }
}

customElements.define('cr-dashboard', CRDashboard);
