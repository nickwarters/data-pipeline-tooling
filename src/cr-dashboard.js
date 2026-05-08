// @ts-check
import { CRElement } from './cr-element.js';

/** @typedef {import('./sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('./sharepoint-client.js').CaseRow} CaseRow */

/**
 * Extracts owned case type slugs from group membership names.
 * Group name format: CaseTypeOwners-{PascalCaseName} → kebab-case slug.
 * e.g. CaseTypeOwners-HelloReview → hello-review
 *
 * @param {string[]} groups
 * @returns {string[]}
 */
function _extractOwnedCaseTypes(groups) {
  return groups
    .filter(g => g.startsWith('CaseTypeOwners-'))
    .map(g => {
      const name = g.slice('CaseTypeOwners-'.length);
      return name.replace(/([A-Z])/g, (m, p1, offset) => offset > 0 ? '-' + p1 : p1).toLowerCase();
    });
}

export class CRDashboard extends CRElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {string} */
    this.currentUserId = '';
    /** @type {string[]} */
    this.userGroups = [];
    /** @type {string[]} */
    this.eligibleCaseTypes = [];
  }

  async connectedCallback() {
    if (!this.client) return;
    const cases = await this.client.listCases({
      status: 'In-progress',
      assignedReviewer: this.currentUserId,
    });
    const ownedCaseTypes = _extractOwnedCaseTypes(this.userGroups);
    this._render(cases, ownedCaseTypes);
  }

  /**
   * Layout: [h1, ul/p, allocationEl, ownerSection?]
   *
   * @param {CaseRow[]} cases
   * @param {string[]} ownedCaseTypes
   */
  _render(cases, ownedCaseTypes = []) {
    const h1 = document.createElement('h1');
    h1.textContent = 'Outstanding Cases';

    /** @type {Element[]} */
    const children = [h1];

    if (cases.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No outstanding cases.';
      children.push(p);
    } else {
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

      children.push(ul);
    }

    const allocationEl = /** @type {import('./cr-allocation.js').CRAllocation} */ (
      document.createElement('cr-allocation')
    );
    allocationEl.client = this.client;
    allocationEl.currentUserId = this.currentUserId;
    allocationEl.eligibleCaseTypes = this.eligibleCaseTypes;
    children.push(allocationEl);

    if (ownedCaseTypes.length > 0) {
      const ownerSection = /** @type {import('./cr-owner-summary.js').CROwnerSummary} */ (
        document.createElement('cr-owner-summary')
      );
      ownerSection.client = this.client;
      ownerSection.ownedCaseTypes = ownedCaseTypes;
      children.push(ownerSection);
    }

    this.replaceChildren(...children);
  }
}

customElements.define('cr-dashboard', CRDashboard);
