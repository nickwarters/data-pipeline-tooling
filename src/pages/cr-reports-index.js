// @ts-check
import { CRElement } from '../components/cr-element.js';

/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

export class CRReportsIndex extends CRElement {
  constructor() {
    super();
    /** @type {Capabilities} */
    this.capabilities = { isReviewer: false, ownedCaseTypes: [], isResponsibleParty: false, isReviewerManager: false, isResponsiblePartyManager: false, isMaintainer: false, isQaReviewer: false, isVisitor: false };
  }

  connectedCallback() {
    this._render();
  }

  _render() {
    /** @type {Element[]} */
    const children = [];

    if (this.capabilities.isReviewerManager) {
      const card = document.createElement('div');
      card.className = 'cr-report-card';

      const title = document.createElement('h2');
      title.textContent = 'Reviewer Team Performance';
      card.appendChild(title);

      const link = document.createElement('a');
      link.href = '#/reports/reviewer-team';
      link.textContent = 'View report';
      card.appendChild(link);

      children.push(card);
    } else {
      const empty = document.createElement('p');
      empty.textContent = "You don't have access to any reports";
      children.push(empty);
    }

    this.replaceChildren(...children);
  }
}

customElements.define('cr-reports-index', CRReportsIndex);
