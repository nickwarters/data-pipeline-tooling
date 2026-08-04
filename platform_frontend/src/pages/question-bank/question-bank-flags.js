// @ts-check
/**
 * URL-param feature flags for the Question Bank workbench, following the
 * `?mock=1` convention: opt-in via the page's query string, no persistence.
 */

/**
 * The impact simulator is gated behind `?simulate=1`: when off,
 * no sample Cases are fetched and the compile drawer hides its simulation
 * panel.
 *
 * @param {string} [search] query string; defaults to the current page's
 * @returns {boolean}
 */
export function simulatorEnabled(
  search = /** @type {any} */ (globalThis).location?.search ?? ''
) {
  return new URLSearchParams(search).get('simulate') === '1';
}
