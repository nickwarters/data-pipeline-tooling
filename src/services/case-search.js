// @ts-check
import { listCasesAcrossSources } from './across-sources.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').ListCasesFilter} ListCasesFilter */
/** @typedef {import('../setup/resolve-eligible-case-types.js').CaseSource} CaseSource */

/**
 * How many matches one search shows. A lookup is a lookup: a result set larger
 * than this is a signal to narrow the filters, not something to page through —
 * paging correctly across several lists needs per-list offset bookkeeping that
 * nothing here does.
 */
export const SEARCH_PAGE_SIZE = 50;

/**
 * Search for Cases across every Case source the viewer holds, or one of them.
 *
 * The fan-out is `listCasesAcrossSources`, so one failing list fails the whole
 * search. That is the right answer here above anywhere else: a lookup that
 * quietly omits a list reports "not found" for a Case that exists.
 *
 * @param {SharePointClient} client
 * @param {ListCasesFilter} filter
 * @param {CaseSource[]} sources
 * @returns {Promise<{ rows: CaseRow[], capped: boolean }>}
 */
export function searchCases(client, filter, sources) {
  const { caseType, ...shared } = filter;
  const targets = caseType
    ? sources.filter((source) => source.slug === caseType)
    : sources;

  return listCasesAcrossSources(
    client,
    targets,
    // Each read names its own Case Type: the server scopes by list and ignores
    // it, but the mock keeps several Case Types in one store and filters on the
    // field, so omitting it over-returns in the dev loop only.
    (source) => ({ ...shared, caseType: source.slug }),
    {
      // One row past the window per list. Because a Case's rank within its own
      // list can never be better than its rank across every list combined, the
      // true global top N all appear in some list's local top N + 1 — so the
      // merged length exceeding N is exactly the condition "there are more
      // matches than we are showing", however many lists there are.
      top: SEARCH_PAGE_SIZE + 1,
      orderBy: 'id',
      orderDir: 'desc',
    }
  ).then((merged) => ({
    // Same key and direction as the per-list `$orderby` above, or the slice
    // would cut a window the per-list reads never guaranteed to be complete —
    // and the comparison must be numeric, because `Id` is a counter carried as
    // a string, where '9' sorts above '100'.
    rows: merged
      .slice()
      .sort((a, b) => Number(b.id) - Number(a.id))
      .slice(0, SEARCH_PAGE_SIZE),
    capped: merged.length > SEARCH_PAGE_SIZE,
  }));
}
