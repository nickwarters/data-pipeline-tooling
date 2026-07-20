// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';

/** @typedef {import('../../services/permissions.js').Capabilities} Capabilities */

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
  const a = h(
    'a',
    { href, class: 'cora-app-nav-item', role: 'listitem' },
    label
  );
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
      ? 'cora-app-nav-item cora-app-nav-item--active'
      : 'cora-app-nav-item';
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
      class: 'cora-app-nav-brand',
      'aria-label': 'CORA — home',
    },
    h('span', { class: 'cora-app-nav-mark', 'aria-hidden': 'true' }, 'C'),
    h('span', { class: 'cora-app-nav-name' }, 'CORA')
  );

  const itemsEl = h('div', { class: 'cora-app-nav-items', role: 'list' });

  const { isReviewer, ownedCaseTypes, isAdviser, isReviewerManager } =
    capabilities;
  const isOwner = ownedCaseTypes.length > 0;
  const hasAnyRole = isReviewer || isAdviser || isReviewerManager || isOwner;

  if (hasAnyRole) {
    itemsEl.appendChild(AppNavItem('Dashboard', '#/dashboard', navItems));
  }
  if (isOwner) {
    itemsEl.appendChild(
      AppNavItem('Question Bank', '#/question-bank', navItems)
    );
  }

  const node = h('div', { class: 'cora-app-nav-bar' }, brand, itemsEl);
  updateActiveNavItems(navItems, hash);
  return { node, navItems };
}

export class CORAAppNav extends ShellElement {
  constructor() {
    super();
    /** @type {Capabilities} */
    this.capabilities = {
      isReviewer: false,
      listAccessCaseTypes: [],
      isAdviser: false,
      ownedCaseTypes: [],
      ownedJourneyCaseTypes: [],
      isControls: false,
      isReviewerManager: false,
      isResponsiblePartyManager: false,
      isMaintainer: false,
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

customElements.define('cora-app-nav', CORAAppNav);
