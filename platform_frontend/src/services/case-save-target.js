// @ts-check
/**
 * How the save queue writes a Case, and when a rejected write is a real
 * conflict rather than a stale ETag.
 *
 * A Case is a conflict only when its Answers moved under the Reviewer. Every
 * other column on the row is written by someone else's action (an allocation,
 * a lifecycle stamp, a flag clock) that the Reviewer's edit does not overlap,
 * so a 412 over one of those is retried on the fresh ETag rather than shown as
 * "edited in another tab".
 */

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('./save-queue.js').SaveTarget} SaveTarget */

/**
 * @param {SharePointClient} client
 * @returns {SaveTarget}
 */
export function caseSaveTarget(client) {
  return {
    patch: (id, fields, etag, opts) =>
      client.patchCase(
        id,
        /** @type {Partial<CaseRow>} */ (fields),
        etag,
        opts
      ),
    get: (id, opts) => client.getCase(id, opts),
    baseline: (item, previous) => {
      const answers = /** @type {CaseRow} */ (item).answers;
      return answers ? { ...answers } : previous;
    },
    isConflict: (baseline, fresh) =>
      JSON.stringify(baseline ?? {}) !==
      JSON.stringify(/** @type {CaseRow} */ (fresh).answers ?? {}),
  };
}
