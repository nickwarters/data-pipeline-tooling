// @ts-check
import { CASE_STATUS } from '../lib/case-statuses.js';
import { daysBetweenDateKeys, toLocalDateKey } from '../lib/local-calendar.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../setup/resolve-eligible-case-types.js').CaseSource} CaseSource */

const DAY_MS = 24 * 60 * 60 * 1000;
/** @type {Set<import('../lib/case-statuses.js').CaseStatus>} */
const OUTSTANDING_STATUSES = new Set([
  CASE_STATUS.IN_PROGRESS,
  CASE_STATUS.ACTIONS_IN_PROGRESS,
]);

/**
 * @typedef {Object} WorkloadRow
 * @property {string | null} reviewerId
 * @property {string} reviewer
 * @property {Record<string, number>} countsByCaseType
 * @property {number} totalOutstanding
 * @property {number | null} longestInProgressDays
 * @property {number} onHold
 * @property {number | null} longestHoldDays
 * @property {boolean} isTotal
 */

/**
 * @param {CaseSource[]} sources
 * @returns {Record<string, number>}
 */
function emptyCaseTypeCounts(sources) {
  return Object.fromEntries(sources.map(({ slug }) => [slug, 0]));
}

/**
 * @param {string | null | undefined} placedOnHoldAt
 * @param {Date} now
 * @returns {number | null}
 */
function holdDays(placedOnHoldAt, now) {
  if (!placedOnHoldAt) return null;
  const placedAt = Date.parse(placedOnHoldAt);
  if (!Number.isFinite(placedAt)) return null;
  return Math.max(0, Math.floor((now.getTime() - placedAt) / DAY_MS));
}

/**
 * Days a Case has been with its current Reviewer, counted the way the Action
 * Centre's "N days in progress" is: between local calendar dates rather than
 * instants, so the figure ticks over at midnight and the two pages agree about
 * the same Case.
 *
 * @param {string | null | undefined} assignedAt
 * @param {Date} now
 * @returns {number | null}
 */
function inProgressDays(assignedAt, now) {
  const assignedDate = toLocalDateKey(assignedAt);
  if (assignedDate === null) return null;
  return Math.max(
    0,
    daysBetweenDateKeys(
      assignedDate,
      /** @type {string} */ (toLocalDateKey(now))
    )
  );
}

/**
 * The larger of two ages, where `null` means "no age known" and never wins.
 *
 * @param {number | null} current
 * @param {number | null} candidate
 * @returns {number | null}
 */
function longest(current, candidate) {
  if (candidate === null) return current;
  return current === null || candidate > current ? candidate : current;
}

/**
 * Build the live manager workload from the Cases returned for their staff.
 * The source list owns the visible Case Type columns; rows outside that
 * resolved source set are ignored rather than inventing page configuration.
 *
 * Staff are currently Case-derived because the application has no independent
 * manager-to-staff roster. A reviewer therefore appears once they have at
 * least one allocated outstanding Case.
 *
 * @param {CaseRow[]} cases
 * @param {CaseSource[]} sources
 * @param {Date} now
 * @returns {WorkloadRow[]}
 */
export function buildTeamWorkload(cases, sources, now) {
  const sourceSlugs = new Set(sources.map(({ slug }) => slug));
  /** @type {Map<string, WorkloadRow>} */
  const byReviewer = new Map();

  for (const item of cases) {
    if (
      !OUTSTANDING_STATUSES.has(item.status) ||
      !item.assignedReviewer ||
      !sourceSlugs.has(item.caseType)
    ) {
      continue;
    }

    let row = byReviewer.get(item.assignedReviewer);
    if (!row) {
      row = {
        reviewerId: item.assignedReviewer,
        reviewer: item.assignedReviewer,
        countsByCaseType: emptyCaseTypeCounts(sources),
        totalOutstanding: 0,
        longestInProgressDays: null,
        onHold: 0,
        longestHoldDays: null,
        isTotal: false,
      };
      byReviewer.set(item.assignedReviewer, row);
    }

    row.countsByCaseType[item.caseType] += 1;
    row.totalOutstanding += 1;
    row.longestInProgressDays = longest(
      row.longestInProgressDays,
      inProgressDays(item.assignedAt, now)
    );
    if (item.onHold === true) {
      row.onHold += 1;
      row.longestHoldDays = longest(
        row.longestHoldDays,
        holdDays(item.placedOnHoldAt, now)
      );
    }
  }

  const staffRows = [...byReviewer.values()].sort((a, b) =>
    a.reviewer.localeCompare(b.reviewer)
  );
  /** @type {WorkloadRow} */
  const total = {
    reviewerId: null,
    reviewer: 'Total',
    countsByCaseType: emptyCaseTypeCounts(sources),
    totalOutstanding: 0,
    longestInProgressDays: null,
    onHold: 0,
    longestHoldDays: null,
    isTotal: true,
  };
  for (const row of staffRows) {
    for (const source of sources) {
      total.countsByCaseType[source.slug] += row.countsByCaseType[source.slug];
    }
    total.totalOutstanding += row.totalOutstanding;
    total.longestInProgressDays = longest(
      total.longestInProgressDays,
      row.longestInProgressDays
    );
    total.onHold += row.onHold;
    total.longestHoldDays = longest(total.longestHoldDays, row.longestHoldDays);
  }

  return [...staffRows, total];
}

/**
 * Apply directory display names without losing the account id used as the
 * stable row identity. Missing names deliberately fall back to the account.
 *
 * Typed by shape rather than by row: every per-Reviewer table on the My Team
 * page names people the same way, and a second copy of this would be a second
 * answer to "what do we call someone the directory does not know".
 *
 * @template {{ reviewerId: string | null, reviewer: string }} Row
 * @param {Row[]} rows
 * @param {Record<string, string | null>} displayNames
 * @returns {Row[]}
 */
export function withReviewerDisplayNames(rows, displayNames) {
  return rows.map((row) =>
    row.reviewerId === null
      ? row
      : {
          ...row,
          reviewer: displayNames[row.reviewerId] || row.reviewerId,
        }
  );
}
