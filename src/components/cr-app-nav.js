// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';

/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

export class CRAppNav extends ReactiveElement {
  constructor() {
    super();
    /** @type {Capabilities} */
    this.capabilities = { isReviewer: false, ownedCaseTypes: [], isResponsibleParty: false, isReviewerManager: false, isResponsiblePartyManager: false, isMaintainer: false, isQaReviewer: false, isVisitor: false };
    /** @type {Array<{el: any, href: string}>} */
    this._navItems = [];
    this._onHashChange = () => this._updateActive();
  }

  connectedCallback() {
    super.connectedCallback();
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
    const content = this.render();
    if (content !== undefined) {
      if (Array.isArray(content)) this.replaceChildren(...content);
      else this.replaceChildren(content);
    } else {
      this.replaceChildren();
    }
    // _updateActive is called within render now, or we can just call it here to be safe
  }

  render() {
    this._navItems = [];

    const brand = h('a', { href: '#/dashboard', class: 'cr-app-nav-brand', 'aria-label': 'Case Review — home' },
      h('span', { class: 'cr-app-nav-mark', 'aria-hidden': 'true' }, 'CR'),
      h('span', { class: 'cr-app-nav-name' }, 'Case Review')
    );

    const itemsEl = h('div', { class: 'cr-app-nav-items', role: 'list' });

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

    const bar = h('div', { class: 'cr-app-nav-bar' }, brand, itemsEl);
    
    // Update active classes immediately on the newly created elements
    const hash = typeof location !== 'undefined' ? (location.hash || '#/') : '#/';
    for (const { el, href } of this._navItems) {
      const active = hash === href || (href !== '#/dashboard' && hash.startsWith(href));
      el.className = active ? 'cr-app-nav-item cr-app-nav-item--active' : 'cr-app-nav-item';
      el.setAttribute('aria-current', active ? 'page' : '');
    }

    return bar;
  }

  /**
   * @param {string} label
   * @param {string} href
   * @returns {any}
   */
  _makeItem(label, href) {
    const a = h('a', { href, class: 'cr-app-nav-item', role: 'listitem' }, label);
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
