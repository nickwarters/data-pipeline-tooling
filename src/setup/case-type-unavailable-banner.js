// @ts-check
/**
 * Boot-time notice for Case Types that could not be loaded.
 *
 * Containment drops a broken Case Type from every resolved source set, which
 * on its own is a SILENT removal: a Reviewer whose Case list is suddenly empty
 * cannot tell a broken deploy from "no Cases assigned". So the removal is
 * stated once, app-wide, in the shape the app already uses for a qualifying
 * condition — the existing `cora-banner cora-banner-warning` styling, appended
 * to the app root next to the UAT badge. It is deliberately NOT a route error
 * panel and NOT fatal: every working Case Type, page and nav item stays usable
 * behind it.
 */

/**
 * @param {import('./resolve-eligible-case-types.js').UnavailableCaseType[]} unavailableCaseTypes
 * @param {Element} appEl
 * @returns {Element | null} the mounted banner, or null when nothing failed
 */
export function mountCaseTypeUnavailableBanner(unavailableCaseTypes, appEl) {
  if (unavailableCaseTypes.length === 0) return null;

  const one = unavailableCaseTypes.length === 1;
  const names = unavailableCaseTypes
    .map((caseType) => caseType.displayName)
    .join(', ');

  const banner = document.createElement('div');
  banner.className = 'cora-banner cora-banner-warning';
  banner.setAttribute('role', 'alert');
  // The underlying error is already on the console for whoever fixes it; the
  // banner says only what a Reviewer can act on.
  banner.textContent =
    `Case Type${one ? '' : 's'} unavailable: ${names}. ` +
    `Cases of ${one ? 'this type' : 'these types'} cannot be shown until this is fixed. ` +
    'Reload to retry, and tell your CORA maintainer if it persists.';
  appEl.appendChild(banner);
  return banner;
}
