// @ts-check
import { CRElement } from './cr-element.js';

/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

export class CRAppNav extends CRElement {
  constructor() {
    super();
    /** @type {Capabilities} */
    this.capabilities = { isReviewer: false, ownedCaseTypes: [], isResponsibleParty: false, isReviewerManager: false };
  }

  connectedCallback() {
    this._render();
  }

  _render() {
    /** @type {Element[]} */
    const links = [];

    if (this.capabilities.isReviewerManager) {
      const a = document.createElement('a');
      a.href = '#/reports';
      a.textContent = 'Reports';
      links.push(a);
    }

    const nav = document.createElement('nav');
    nav.append(...links);
    this.replaceChildren(nav);
  }
}

customElements.define('cr-app-nav', CRAppNav);
