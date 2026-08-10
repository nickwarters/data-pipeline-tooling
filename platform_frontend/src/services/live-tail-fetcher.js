// @ts-check
import { listCasesAcrossSources } from './across-sources.js';
import { CASE_STATUS } from '../lib/case-statuses.js';
import {
  isDateKey,
  shiftDateKey,
  startOfLocalDay,
} from '../lib/local-calendar.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../setup/resolve-eligible-case-types.js').CaseSource} CaseSource */

/**
 * The furthest back the live tail may ever reach, counting today as day one.
 *
 * My Stats reads Case lists directly for the days its published report cannot
 * cover yet, and that is only defensible while the read stays small. What makes
 * it small is this constant, not the report: the report says how *stale* it is,
 * and a report that is missing, malformed or months old would otherwise ask for
 * an unbounded walk of every Case the Reviewer has ever finished — every page
 * of it, each row dragging back the full projection.
 *
 * Ten days is derived from how stale a healthy report can honestly be. The
 * producing pipeline runs Monday to Friday and covers dates through the
 * previous day, so the structural worst case is a Friday artifact still being
 * the freshest one on Monday: complete through Thursday, leaving Friday,
 * Saturday, Sunday and Monday to compute — four days. A public holiday either
 * side of a weekend stretches that: the Easter pattern (Good Friday and Easter
 * Monday both non-running) leaves Thursday through the following Tuesday, six.
 * Ten leaves several more days of slack for a failed run without ever becoming
 * the kind of read this page was built to avoid.
 *
 * Past ten days the tail is deliberately short rather than large. The page says
 * so — a report that stale leaves days it cannot account for, and telling the
 * Reviewer is better than quietly showing them a zero or spending their morning
 * on a full list walk.
 */
export const LIVE_TAIL_MAX_DAYS = 10;

/**
 * The window the live read should cover: the days after the report's
 * `complete_through`, clamped so it can never reach further back than
 * `LIVE_TAIL_MAX_DAYS`.
 *
 * Returns `null` when there is nothing to read — a report already complete
 * through today or later leaves no tail, and the right number of requests to
 * issue for no days is none.
 *
 * The bounds are instants because that is what a SharePoint date filter
 * compares, and they are the *local* start of each day because the counts are
 * bucketed by local calendar date afterwards. The upper bound is exclusive, so
 * the window is exactly "from the start of `from`, up to the start of
 * tomorrow".
 *
 * @param {string | null | undefined} completeThrough `YYYY-MM-DD` from the report
 * @param {string} todayKey browser-local `YYYY-MM-DD`
 * @returns {{ from: string, reportableAfter: string, reportableBefore: string } | null}
 */
export function liveTailWindow(completeThrough, todayKey) {
  const earliest = shiftDateKey(todayKey, -(LIVE_TAIL_MAX_DAYS - 1));
  // An unusable boundary — absent, or not a calendar date — means the report
  // vouches for nothing, so the clamp alone decides the window.
  const wanted = isDateKey(completeThrough)
    ? shiftDateKey(/** @type {string} */ (completeThrough), 1)
    : earliest;
  const from = wanted < earliest ? earliest : wanted;
  if (from > todayKey) return null;
  return {
    from,
    reportableAfter: startOfLocalDay(from).toISOString(),
    reportableBefore: startOfLocalDay(shiftDateKey(todayKey, 1)).toISOString(),
  };
}

/**
 * Read the Reviewer's own reportable Cases inside that window, one scoped
 * request per Case Type list.
 *
 * The predicate leads with the indexed `ReportableAt` range and the indexed
 * Assigned Reviewer, so the server does the narrowing. The status pair is what
 * makes the population *reportable work*: a Case voided after its Answers were
 * frozen still carries a `reportableAt` but is not reviewed work and must not
 * be counted as any.
 *
 * No `top`: a page size here would silently undercount a busy week, and the
 * window is already the bound. The caller binds the mount lifetime to the
 * client before handing it over, so nothing in this file knows about
 * cancellation.
 *
 * @param {SharePointClient} client
 * @param {string} reviewerId
 * @param {CaseSource[]} sources
 * @param {{ reportableAfter: string, reportableBefore: string }} tailWindow
 * @returns {Promise<CaseRow[]>}
 */
export function fetchLiveTailCases(client, reviewerId, sources, tailWindow) {
  return listCasesAcrossSources(client, sources, (source) => ({
    caseType: source.slug,
    assignedReviewer: reviewerId,
    reportableAfter: tailWindow.reportableAfter,
    reportableBefore: tailWindow.reportableBefore,
    anyOf: [
      { status: CASE_STATUS.ACTIONS_IN_PROGRESS },
      { status: CASE_STATUS.COMPLETED },
    ],
  }));
}
