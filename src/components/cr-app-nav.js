// @ts-check
import { CRElement } from './cr-element.js';

/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

export class CRAppNav extends CRElement {
  constructor() {
    super();
    /** @type {Capabilities} */
    this.capabilities = { isReviewer: false, ownedCaseTypes: [], isResponsibleParty: false, isReviewerManager: false, isResponsiblePartyManager: false, isMaintainer: false, isVisitor: false };
    /** @type {Array<{el: any, href: string}>} */
    this._navItems = [];
    this._onHashChange = () => this._updateActive();
  }

  connectedCallback() {
    this._render();
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('hashchange', this._onHashChange);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('hashchange', this._onHashChange);
    }
  }

  _render() {
    this._navItems = [];

    const bar = document.createElement('div');
    bar.className = 'cr-app-nav-bar';

    const brand = document.createElement('a');
    brand.href = '#/dashboard';
    brand.className = 'cr-app-nav-brand';
    brand.setAttribute('aria-label', 'Case Review — home');

    const mark = document.createElement('span');
    mark.className = 'cr-app-nav-mark';
    mark.textContent = 'CR';
    mark.setAttribute('aria-hidden', 'true');

    const name = document.createElement('span');
    name.className = 'cr-app-nav-name';
    name.textContent = 'Case Review';

    brand.append(mark, name);

    const itemsEl = document.createElement('div');
    itemsEl.className = 'cr-app-nav-items';
    itemsEl.setAttribute('role', 'list');

    const { isReviewer, ownedCaseTypes, isResponsibleParty, isReviewerManager } = this.capabilities;
    const isOwner = ownedCaseTypes.length > 0;
    const hasAnyRole = isReviewer || isResponsibleParty || isReviewerManager || isOwner;

    if (hasAnyRole) {
      itemsEl.appendChild(this._makeItem('Dashboard', '#/dashboard'));
    }
    if (isReviewerManager || isOwner) {
      itemsEl.appendChild(this._makeItem('Reports', '#/reports'));
    }
    if (isOwner) {
      itemsEl.appendChild(this._makeItem('Question Bank', '#/question-bank'));
    }

    bar.append(brand, itemsEl);
    this.replaceChildren(bar);
    this._updateActive();
  }

  /**
   * @param {string} label
   * @param {string} href
   * @returns {any}
   */
  _makeItem(label, href) {
    const a = document.createElement('a');
    a.href = href;
    a.className = 'cr-app-nav-item';
    a.textContent = label;
    a.setAttribute('role', 'listitem');
    this._navItems.push({ el: a, href });
    return a;
  }

  _updateActive() {
    const hash = typeof location !== 'undefined' ? (location.hash || '#/') : '#/';
    for (const { el, href } of this._navItems) {
      const active = hash === href || (href !== '#/dashboard' && hash.startsWith(href));
      el.className = active ? 'cr-app-nav-item cr-app-nav-item--active' : 'cr-app-nav-item';
      el.setAttribute('aria-current', active ? 'page' : '');
    }
  }
}

customElements.define('cr-app-nav', CRAppNav);
