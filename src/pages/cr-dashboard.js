// @ts-check
import { CRElement } from '../components/cr-element.js';
import '../components/cr-case-table.js';
import './cr-responsible-party-dashboard.js';
import { isOverdue } from '../evaluators/overdue-evaluator.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */
/** @typedef {import('../components/cr-case-table.js').CRCaseTable} CRCaseTable */

export class CRDashboard extends CRElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {string} */
    this.currentUserId = '';
    /** @type {Capabilities} */
    this.capabilities = { isReviewer: false, ownedCaseTypes: [], isResponsibleParty: false, isReviewerManager: false, isResponsiblePartyManager: false, isMaintainer: false, isVisitor: false };
    /** @type {string[]} */
    this.eligibleCaseTypes = [];
  }

  async connectedCallback() {
    if (!this.client) return;
    /** @type {CaseRow[]} */
    let cases = [];
    if (this.capabilities.isReviewer) {
      const raw = await this.client.listCases({
        status: 'In-progress',
        assignedReviewer: this.currentUserId,
      });
      cases = raw.map(c => ({ ...c, overdue: isOverdue(c) }));
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

      const allocationEl = /** @type {import('../components/cr-allocation.js').CRAllocation} */ (
        document.createElement('cr-allocation')
      );
      allocationEl.client = this.client;
      allocationEl.currentUserId = this.currentUserId;
      allocationEl.eligibleCaseTypes = this.eligibleCaseTypes;
      allocationEl.addEventListener('cr-allocated', () => this.connectedCallback());
      children.push(allocationEl);
    }

    if (this.capabilities.ownedCaseTypes.length > 0) {
      const ownerSection = /** @type {import('../components/cr-owner-summary.js').CROwnerSummary} */ (
        document.createElement('cr-owner-summary')
      );
      ownerSection.client = this.client;
      ownerSection.ownedCaseTypes = this.capabilities.ownedCaseTypes;
      children.push(ownerSection);
    }

    if (this.capabilities.isResponsibleParty) {
      const rpEl = /** @type {import('./cr-responsible-party-dashboard.js').CRResponsiblePartyDashboard} */ (
        document.createElement('cr-responsible-party-dashboard')
      );
      rpEl.client = this.client;
      rpEl.currentUserId = this.currentUserId;
      rpEl.addEventListener('cr-open-conversation', (/** @type {any} */ e) => {
        location.hash = `#/conversation/${e.detail.caseId}`;
      });
      children.push(rpEl);
    }

    this.replaceChildren(...children);
  }
}

customElements.define('cr-dashboard', CRDashboard);
