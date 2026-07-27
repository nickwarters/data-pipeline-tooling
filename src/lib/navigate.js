// @ts-check

/**
 * The single seam through which the app changes route (ADR-0002). Views take it
 * as a callback instead of reaching for a browser global.
 *
 * The writing half only: `lib/router.js` listens to `hashchange` and knows
 * nothing about this module, so the writer and the listener never form a cycle.
 *
 * @param {string} hash - a full route hash, e.g. '#/case/complaints/123'
 * @returns {void}
 */
export function navigateTo(hash) {
  location.hash = hash;
}

/**
 * Replace rather than push — for redirects that should not add a history entry,
 * e.g. an eligibility guard bouncing an ineligible user off a route. The path
 * and query are carried over unchanged so the SharePoint host page is not
 * reloaded.
 *
 * That is the reason for the `#` check: an argument without one produces a URL
 * the browser treats as a different document, which full-reloads the `.aspx`
 * host page — the one thing a single-host-page SPA must never do by accident.
 * Thrown from a route guard it surfaces as the `cora-route-error` panel, which
 * is worth knowing before writing a guard that computes its destination.
 *
 * @param {string} hash - a full route hash; must begin with '#', e.g. '#/'
 * @returns {void}
 */
export function redirectTo(hash) {
  if (!hash.startsWith('#')) {
    throw new Error(
      `redirectTo expects a route hash beginning with '#', got: ${hash}`
    );
  }
  location.replace(`${location.pathname}${location.search}${hash}`);
}
