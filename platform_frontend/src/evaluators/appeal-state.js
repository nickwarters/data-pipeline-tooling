// @ts-check

/** @typedef {import('../sharepoint-client.js').Appeal} Appeal */

/**
 * The one Appeal still awaiting resolution, or `null`.
 *
 * A Case allows at most one open Appeal at a time, so "not resolved" is a
 * membership question with a single answer. The Appeal views, the Controls
 * worklist, Section access and the flag that hoists it onto a queryable column
 * all ask it, and each used to carry its own copy of the predicate — which is
 * how a rule acquires three definitions that can drift apart one at a time.
 * This is now the only one, and it sits here so pages and services can both
 * reach it.
 *
 * The parameter is anything carrying an `appeals` list, not strictly a Case
 * Row, because the pairing below asks the question of a list that has not been
 * merged onto a row yet.
 *
 * @param {{ appeals?: Appeal[] } | null | undefined} caseRow
 * @returns {Appeal | null}
 */
export function openAppealOf(caseRow) {
  return (caseRow?.appeals ?? []).find((a) => a.state !== 'resolved') ?? null;
}
