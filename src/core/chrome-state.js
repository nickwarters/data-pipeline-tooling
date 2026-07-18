// @ts-check

/**
 * State shared by every store-driven route. The chrome UI is still being
 * strangled out of the legacy component architecture, but its state already
 * has one stable home so converted pages do not invent route-local copies.
 *
 * @typedef {Object} ChromeState
 * @property {string[]} toasts
 * @property {{ currentHash: string }} nav
 * @property {import('../sharepoint-client.js').CurrentUser} currentUser
 * @property {import('../services/permissions.js').Capabilities} permissions
 */

/**
 * Create the shared chrome slice once during application boot.
 *
 * @param {{
 *   currentUser: import('../sharepoint-client.js').CurrentUser,
 *   permissions: import('../services/permissions.js').Capabilities,
 *   currentHash?: string,
 * }} input
 * @returns {ChromeState}
 */
export function createChromeState({
  currentUser,
  permissions,
  currentHash = '#/',
}) {
  return {
    toasts: [],
    nav: { currentHash },
    currentUser,
    permissions,
  };
}

/**
 * Keep the boot-owned navigation state in sync for the application lifetime.
 * Chrome is shared by reference during the route-by-route migration, so named
 * helpers own its writes; route reducers treat the object as read-only.
 *
 * @param {ChromeState} chrome
 * @param {{
 *   target?: EventTarget,
 *   readHash?: () => string,
 * }} [options]
 * @returns {() => void}
 */
export function bindChromeNavigation(
  chrome,
  { target = window, readHash = () => location.hash || '#/' } = {}
) {
  const sync = () => {
    chrome.nav.currentHash = readHash() || '#/';
  };
  target.addEventListener('hashchange', sync);
  return () => target.removeEventListener('hashchange', sync);
}
