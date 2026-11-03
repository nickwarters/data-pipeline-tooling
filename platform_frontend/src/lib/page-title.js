// @ts-check

/**
 * The browser tab's title, the one place it is set.
 *
 * It matters beyond the tab strip: when a user copies the address bar, Edge
 * pastes a hyperlink whose text is this title. CORA used to set none, and a
 * Content Editor discards the host page's own `<title>`, so every pasted link
 * read as SharePoint's default "<site> - <page>" ("CORA - app") whatever it
 * pointed at. A link to a Case should say which Case.
 *
 * The router adapter titles every route from its page plugin's `title` (or
 * nav label) as it mounts, so a page that sets nothing still never keeps the
 * previous page's title. A page that knows something more specific once its
 * data arrives, as the Case page does, sets it again.
 */

/** The suffix every title carries, and the whole title when a page has none. */
export const APP_TITLE = 'CORA';

/**
 * Compose a title from its most-specific-first parts, e.g.
 * `formatPageTitle('CMP-1234', 'Complaints')` is "CMP-1234 · Complaints — CORA".
 * Blank and missing parts are dropped, so a caller need not guard each one.
 *
 * @param {...(string | null | undefined)} parts
 * @returns {string}
 */
export function formatPageTitle(...parts) {
  const named = parts.map((part) => (part ?? '').trim()).filter(Boolean);
  return named.length > 0 ? `${named.join(' · ')} — ${APP_TITLE}` : APP_TITLE;
}

/**
 * Set the tab title. A no-op outside a browser, so a page's effect can call it
 * unconditionally.
 *
 * @param {...(string | null | undefined)} parts
 * @returns {void}
 */
export function setPageTitle(...parts) {
  if (typeof document === 'undefined') return;
  document.title = formatPageTitle(...parts);
}
