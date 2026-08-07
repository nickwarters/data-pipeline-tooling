// @ts-check
/**
 * The app-wide "boot did not finish" panel, shared with the fatal-nav path in
 * `setup/app-chrome.js`.
 *
 * Deliberately not `lib/route-error-panel.js`: that panel offers a way back to
 * the rest of the app, because a failed route means one page is broken and
 * everything else still works. At boot nothing else works — there is no nav to
 * return to and no route to retry — so the only honest instruction is "reload,
 * and tell someone if it keeps happening".
 */

const DEFAULT_MESSAGE =
  'CORA failed to start. Reload to retry, and tell your CORA maintainer if it persists.';

/**
 * The raw error is deliberately absent: it is meaningless to a Reviewer and can
 * leak internals into the page. It goes to the console instead.
 *
 * @param {string} [message]
 * @returns {HTMLElement}
 */
export function createBootErrorPanel(message = DEFAULT_MESSAGE) {
  const panel = document.createElement('div');
  panel.className = 'cora-boot-error';
  panel.setAttribute('role', 'alert');
  panel.textContent = message;
  return panel;
}

/**
 * Commits the panel, replacing whatever boot managed to render. The body
 * fallback is reachable: `app.js` uses `getElementById('app')` without a null
 * check, so a host page missing that root throws straight into this handler.
 *
 * @param {unknown} error
 * @returns {void}
 */
export function renderBootError(error) {
  console.error('[CORA] Boot error:', error);
  const target = document.getElementById('app') ?? document.body;
  target.replaceChildren(createBootErrorPanel());
}
