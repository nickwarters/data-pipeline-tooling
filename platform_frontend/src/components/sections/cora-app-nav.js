// @ts-check
import { h } from '../../lib/html.js';

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
 * The nav bar, drawn from items it is handed.
 *
 * It reads no capability and names no page. Which links a user gets, and in
 * what order, is a property of what the application is composed of, so it is
 * answered where that is declared and passed in — which also means this can be
 * rendered in a test without the application's configuration, and two tests
 * cannot interfere by configuring it differently.
 *
 * @param {{
 *   items: { id: string, label: string, href: string }[],
 *   brandHref: string,
 *   hash: string
 * }} props
 * @returns {{ node: HTMLElement, navItems: NavItemRef[] }}
 */
export function AppNav({ items, brandHref, hash }) {
  /** @type {NavItemRef[]} */
  const navItems = [];
  const brand = h(
    'a',
    {
      href: brandHref,
      className: 'cora-app-nav-brand',
      'aria-label': 'CORA — home',
    },
    h('span', { className: 'cora-app-nav-mark', 'aria-hidden': 'true' }, 'C'),
    h('span', { className: 'cora-app-nav-name' }, 'CORA')
  );

  const itemsEl = h('div', { className: 'cora-app-nav-items', role: 'list' });
  for (const item of items) {
    itemsEl.appendChild(AppNavItem(item.label, item.href, navItems));
  }

  const node = h('div', { className: 'cora-app-nav-bar' }, brand, itemsEl);
  updateActiveNavItems(navItems, hash);
  return { node, navItems };
}
