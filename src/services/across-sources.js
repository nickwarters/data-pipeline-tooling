// @ts-check
/**
 * Multi-list fan-out helpers.
 *
 * There is no default Case list (ADR-0022 amendment): every Case read carries
 * an explicit `listName`, and a Case lives in exactly one list, so a read that
 * spans Case Types fans out one scoped request per source and merges. These
 * helpers own that pattern so call sites don't hand-roll it.
 *
 * Failure semantics are deliberate: a bare `Promise.all`, so the whole read
 * fails as a unit. A 403 on one list means broken ACL provisioning and must
 * surface, not be silently omitted from the merge.
 */

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').ListCasesFilter} ListCasesFilter */
/** @typedef {import('../sharepoint-client.js').CaseListOptions} CaseListOptions */

/**
 * A filter shared by every source, or a function deriving one per source
 * (e.g. `(source) => ({ caseType: source.slug })`).
 * @template {{ listName: string }} S
 * @typedef {ListCasesFilter | ((source: S) => ListCasesFilter)} FilterOf
 */

/**
 * @template {{ listName: string }} S
 * @param {FilterOf<S>} filter
 * @param {S} source
 * @returns {ListCasesFilter}
 */
function resolveFilter(filter, source) {
  return typeof filter === 'function' ? filter(source) : filter;
}

/**
 * Fan out `listCases` over `sources`, keeping each source's rows paired with
 * the source they came from — for callers that need per-list results (row
 * tagging, per-list windowed merges).
 *
 * @template {{ listName: string }} S
 * @param {SharePointClient} client
 * @param {S[]} sources
 * @param {FilterOf<S>} filter
 * @param {Omit<CaseListOptions, 'listName'>} [options] shared list options; the
 *   per-source `listName` is applied on top.
 * @returns {Promise<{ source: S, rows: CaseRow[] }[]>}
 */
export function listCasesPerSource(client, sources, filter, options = {}) {
  return Promise.all(
    sources.map((source) =>
      client
        .listCases(resolveFilter(filter, source), {
          ...options,
          listName: source.listName,
        })
        .then((rows) => ({ source, rows }))
    )
  );
}

/**
 * Fan out `listCases` over `sources` and flatten into one merged array, in
 * source order.
 *
 * @template {{ listName: string }} S
 * @param {SharePointClient} client
 * @param {S[]} sources
 * @param {FilterOf<S>} filter
 * @param {Omit<CaseListOptions, 'listName'>} [options]
 * @returns {Promise<CaseRow[]>}
 */
export function listCasesAcrossSources(client, sources, filter, options) {
  return Promise.all(
    sources.map((source) =>
      client.listCases(resolveFilter(filter, source), {
        ...options,
        listName: source.listName,
      })
    )
  ).then((perSource) => perSource.flat());
}

/**
 * Fan out `countCases` over `sources` and sum the per-list counts.
 *
 * @template {{ listName: string }} S
 * @param {SharePointClient} client
 * @param {S[]} sources
 * @param {FilterOf<S>} filter
 * @returns {Promise<number>}
 */
export function countCasesAcrossSources(client, sources, filter) {
  return Promise.all(
    sources.map((source) =>
      client.countCases(resolveFilter(filter, source), {
        listName: source.listName,
      })
    )
  ).then((counts) => counts.reduce((total, n) => total + n, 0));
}
