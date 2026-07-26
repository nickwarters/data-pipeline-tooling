// @ts-check

/**
 * The single seam through which the app changes route. Hash routing (ADR-0002)
 * makes this a one-liner today; having it named means views can take it as a
 * callback instead of reaching for a browser global, and tests can assert
 * navigation without stubbing `location`.
 *
 * This is the writing half only. `lib/router.js` listens to `hashchange` and
 * knows nothing about this module — deliberately, so the writer and the
 * listener never form a cycle.
 *
 * @param {string} hash - a full route hash, e.g. '#/case/complaints/123'
 * @returns {void}
 */
export function navigateTo(hash) {
  location.hash = hash;
}

/**
 * Replace rather than push — for redirects that should not add a history
 * entry, e.g. an eligibility guard bouncing an ineligible user off a route.
 * The path and query are carried over unchanged so the SharePoint host page
 * is not reloaded.
 *
 * That last part is the whole reason for the `#` check: only the fragment may
 * differ from the current URL. An argument without one produces a URL the
 * browser treats as a different document, which full-reloads the `.aspx` host
 * page — the one thing a single-host-page SPA must never do by accident.
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
