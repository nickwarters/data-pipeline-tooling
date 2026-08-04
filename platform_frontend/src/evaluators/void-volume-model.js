// @ts-check
import { VOID_REASONS, voidReasonLabel } from '../lib/void-reasons.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../setup/resolve-eligible-case-types.js').CaseSource} CaseSource */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The two windows the report reports, in days. */
const RECENT_DAYS = 7;
const WINDOW_DAYS = 30;

/**
 * @typedef {Object} VoidVolumeRow
 * @property {string | null} reviewerId
 * @property {string} reviewer
 * @property {number} last7
 * @property {number} last30
 * @property {Record<string, number>} countsByCaseType
 * @property {string} leadingReason
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
 * The most-used reason in a tally, as its display label. Ties go to whichever
 * reason the framework lists first, so the same tally always reads the same way
 * rather than depending on the order rows happened to arrive.
 *
 * @param {Map<string, number>} tally
 * @returns {string}
 */
function leadingReasonOf(tally) {
  /** @type {string | null} */
  let leader = null;
  let leaderCount = 0;
  const order = VOID_REASONS.map((reason) => reason.key);
  const rank = (/** @type {string} */ key) => {
    const index = order.indexOf(key);
    return index === -1 ? order.length : index;
  };
  for (const [key, count] of tally) {
    if (
      count > leaderCount ||
      (count === leaderCount && leader !== null && rank(key) < rank(leader))
    ) {
      leader = key;
      leaderCount = count;
    }
  }
  return leader === null ? '—' : voidReasonLabel(leader);
}

/**
 * Build the manager's void-volume report from the Cases voided across their
 * team. Grouped by `voidedBy` — who ended the Case, which is the question a
 * manager reading this is asking.
 *
 * One 30-day read answers both columns: the 7-day split is derived here rather
 * than fetched twice. Anything older than the 30-day window contributes
 * nothing, so a Reviewer with no recent voids does not appear at all.
 *
 * @param {CaseRow[]} cases
 * @param {CaseSource[]} sources
 * @param {Date} now
 * @returns {VoidVolumeRow[]}
 */
export function buildVoidVolumes(cases, sources, now) {
  const sourceSlugs = new Set(sources.map(({ slug }) => slug));
  // Inclusive lower bounds: a Case voided exactly seven days ago is in the
  // seven-day column, so two adjacent readings of the report never disagree
  // about a boundary Case.
  const recentFrom = now.getTime() - RECENT_DAYS * DAY_MS;
  const windowFrom = now.getTime() - WINDOW_DAYS * DAY_MS;

  /** @type {Map<string, VoidVolumeRow>} */
  const byReviewer = new Map();
  /** @type {Map<string, Map<string, number>>} */
  const reasonsByReviewer = new Map();
  /** @type {Map<string, number>} */
  const reasonsOverall = new Map();

  for (const item of cases) {
    const voidedBy = item.voidedBy;
    if (!voidedBy || !sourceSlugs.has(item.caseType) || !item.voidedAt)
      continue;
    const voidedAt = Date.parse(item.voidedAt);
    if (!Number.isFinite(voidedAt) || voidedAt < windowFrom) continue;

    let row = byReviewer.get(voidedBy);
    if (!row) {
      row = {
        reviewerId: voidedBy,
        reviewer: voidedBy,
        last7: 0,
        last30: 0,
        countsByCaseType: emptyCaseTypeCounts(sources),
        leadingReason: '—',
        isTotal: false,
      };
      byReviewer.set(voidedBy, row);
      reasonsByReviewer.set(voidedBy, new Map());
    }

    row.last30 += 1;
    if (voidedAt >= recentFrom) row.last7 += 1;
    row.countsByCaseType[item.caseType] += 1;
    if (item.voidReason) {
      const tally = /** @type {Map<string, number>} */ (
        reasonsByReviewer.get(voidedBy)
      );
      tally.set(item.voidReason, (tally.get(item.voidReason) ?? 0) + 1);
      reasonsOverall.set(
        item.voidReason,
        (reasonsOverall.get(item.voidReason) ?? 0) + 1
      );
    }
  }

  const staffRows = [...byReviewer.values()].sort((a, b) =>
    a.reviewer.localeCompare(b.reviewer)
  );
  for (const row of staffRows) {
    row.leadingReason = leadingReasonOf(
      /** @type {Map<string, number>} */ (
        reasonsByReviewer.get(row.reviewerId ?? '')
      )
    );
  }

  /** @type {VoidVolumeRow} */
  const total = {
    reviewerId: null,
    reviewer: 'Total',
    last7: 0,
    last30: 0,
    countsByCaseType: emptyCaseTypeCounts(sources),
    leadingReason: leadingReasonOf(reasonsOverall),
    isTotal: true,
  };
  for (const row of staffRows) {
    total.last7 += row.last7;
    total.last30 += row.last30;
    for (const source of sources) {
      total.countsByCaseType[source.slug] += row.countsByCaseType[source.slug];
    }
  }

  return [...staffRows, total];
}
