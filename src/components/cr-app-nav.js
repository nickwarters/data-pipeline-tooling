// @ts-check
import { ShellElement } from '../lib/view.js';
import { h } from '../lib/html.js';

/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

/**
 * @typedef {{ el: HTMLElement, href: string }} NavItemRef
 */

/**
 * @param {string} label
 * @param {string} href
 * @param {NavItemRef[]} navItems
 * @returns {HTMLElement}
 */
export function AppNavItem(label, href, navItems) {
  const a = h('a', { href, class: 'cr-app-nav-item', role: 'listitem' }, label);
  navItems.push({ el: a, href });
  return a;
}

/**
 * @param {NavItemRef[]} navItems
 * @param {string} hash
 */
export function updateActiveNavItems(navItems, hash) {
  for (const { el, href } of navItems) {
    const active =
      hash === href || (href !== '#/dashboard' && hash.startsWith(href));
    el.className = active
      ? 'cr-app-nav-item cr-app-nav-item--active'
      : 'cr-app-nav-item';
    el.setAttribute('aria-current', active ? 'page' : '');
  }
}

/**
 * @param {{ capabilities: Capabilities, hash: string }} props
 * @returns {{ node: HTMLElement, navItems: NavItemRef[] }}
 */
export function AppNav({ capabilities, hash }) {
  /** @type {NavItemRef[]} */
  const navItems = [];
  const brand = h(
    'a',
    {
      href: '#/dashboard',
      class: 'cr-app-nav-brand',
      'aria-label': 'Case Review — home',
    },
    h('span', { class: 'cr-app-nav-mark', 'aria-hidden': 'true' }, 'CR'),
    h('span', { class: 'cr-app-nav-name' }, 'Case Review')
  );

  const itemsEl = h('div', { class: 'cr-app-nav-items', role: 'list' });

  const { isReviewer, ownedCaseTypes, isResponsibleParty, isReviewerManager } =
    capabilities;
  const isOwner = ownedCaseTypes.length > 0;
  const hasAnyRole =
    isReviewer || isResponsibleParty || isReviewerManager || isOwner;

  if (hasAnyRole) {
    itemsEl.appendChild(AppNavItem('Dashboard', '#/dashboard', navItems));
  }
  if (isReviewerManager || isOwner) {
    itemsEl.appendChild(AppNavItem('Reports', '#/reports', navItems));
  }
  if (isOwner) {
    itemsEl.appendChild(
      AppNavItem('Question Bank', '#/question-bank', navItems)
    );
  }

  const node = h('div', { class: 'cr-app-nav-bar' }, brand, itemsEl);
  updateActiveNavItems(navItems, hash);
  return { node, navItems };
}

export class CRAppNav extends ShellElement {
  constructor() {
    super();
    /** @type {Capabilities} */
    this.capabilities = {
      isReviewer: false,
      ownedCaseTypes: [],
      isResponsibleParty: false,
      isReviewerManager: false,
      isResponsiblePartyManager: false,
      isMaintainer: false,
      isQaReviewer: false,
      isVisitor: false,
    };
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
    const hash = typeof location !== 'undefined' ? location.hash || '#/' : '#/';
    const { node, navItems } = AppNav({
      capabilities: this.capabilities,
      hash,
    });
    this._navItems = navItems;
    return node;
  }

  /**
   * @param {string} label
   * @param {string} href
   * @returns {any}
   */
  _makeItem(label, href) {
    return AppNavItem(label, href, this._navItems);
  }

  _updateActive() {
    const hash = typeof location !== 'undefined' ? location.hash || '#/' : '#/';
    updateActiveNavItems(this._navItems, hash);
  }
}

customElements.define('cr-app-nav', CRAppNav);
