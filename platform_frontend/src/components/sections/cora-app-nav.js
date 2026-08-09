// @ts-check
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
function AppNavItem(label, href, navItems) {
  const a = h(
    'a',
    { href, className: 'cora-app-nav-item', role: 'listitem' },
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
      className: 'cora-app-nav-brand',
      'aria-label': 'CORA — home',
    },
    h('span', { className: 'cora-app-nav-mark', 'aria-hidden': 'true' }, 'C'),
    h('span', { className: 'cora-app-nav-name' }, 'CORA')
  );

  const itemsEl = h('div', { className: 'cora-app-nav-items', role: 'list' });

  const {
    isReviewer,
    ownedCaseTypes,
    isAdviser,
    isReviewerManager,
    isControls,
    canSearchCases,
  } = capabilities;
  const isOwner = ownedCaseTypes.length > 0;
  // Controls belong here too: without them a Controls-only account reached no
  // nav item at all, not even the Dashboard.
  const hasAnyRole =
    isReviewer || isAdviser || isReviewerManager || isOwner || isControls;

  if (hasAnyRole) {
    itemsEl.appendChild(AppNavItem('Dashboard', '#/dashboard', navItems));
    itemsEl.appendChild(AppNavItem('Roadmap', '#/roadmap', navItems));
  }
  if (isReviewer) {
    itemsEl.appendChild(AppNavItem('My Stats', '#/my-stats', navItems));
  }
  if (isOwner) {
    itemsEl.appendChild(
      AppNavItem('Question Bank', '#/question-bank', navItems)
    );
  }
  if (isReviewerManager) {
    itemsEl.appendChild(AppNavItem('My Team', '#/my-team', navItems));
  }
  if (canSearchCases) {
    itemsEl.appendChild(AppNavItem('Search', '#/search', navItems));
  }

  const node = h('div', { className: 'cora-app-nav-bar' }, brand, itemsEl);
  updateActiveNavItems(navItems, hash);
  return { node, navItems };
}
