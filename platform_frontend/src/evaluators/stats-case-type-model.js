// @ts-check

import {
  displayNameFor,
  UnknownCaseTypeError,
} from '../../case-types/manifest.js';

/** @typedef {import('../services/report-feed-loader.js').ReportFeedEnvelope['rows'][number]} ReportFeedRow */

/**
 * @typedef {Object} StatsCaseTypeRow
 * @property {string} key - The stable Case Type slug from the feed.
 * @property {string} label - The display name shown to the user.
 * @property {number} count
 * @property {number} share - The unrounded proportion of the total.
 */

/**
 * @typedef {Object} StatsCaseTypeBreakdown
 * @property {StatsCaseTypeRow[]} rows
 * @property {number} total
 */

/** @returns {StatsCaseTypeBreakdown} */
function emptyBreakdown() {
  return { rows: [], total: 0 };
}

/**
 * Turn an unregistered feed slug into presentation copy without exposing the
 * persisted identifier as visible or accessible text.
 *
 * @param {string} slug
 * @returns {string}
 */
function humanizeUnknownSlug(slug) {
  const words = slug
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
  const label = words.join(' ');
  return label && label !== slug ? label : 'Unknown Case Type';
}

/**
 * @param {string} slug
 * @returns {string}
 */
function labelFor(slug) {
  try {
    return displayNameFor(slug);
  } catch (error) {
    if (!(error instanceof UnknownCaseTypeError)) throw error;
    return humanizeUnknownSlug(slug);
  }
}

/**
 * Build the Case Type totals for one inclusive, date-only range.
 *
 * Feed dates and range boundaries are ISO date strings, so lexical comparison
 * preserves calendar order without introducing a timezone or monthly bucket.
 *
 * @param {ReportFeedRow[]} rows
 * @param {{ start: string, end: string }} range
 * @returns {StatsCaseTypeBreakdown}
 */
export function buildStatsCaseTypeBreakdown(rows, range) {
  if (!Array.isArray(rows)) return emptyBreakdown();

  /** @type {Map<string, number>} */
  const totalsBySlug = new Map();

  for (const row of rows) {
    if (
      typeof row?.date !== 'string' ||
      row.date < range.start ||
      row.date > range.end ||
      typeof row.case_type !== 'string' ||
      row.case_type.length === 0 ||
      typeof row.count !== 'number' ||
      !Number.isFinite(row.count)
    ) {
      continue;
    }

    totalsBySlug.set(
      row.case_type,
      (totalsBySlug.get(row.case_type) ?? 0) + row.count
    );
  }

  const positiveRows = [...totalsBySlug.entries()]
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ key, label: labelFor(key), count }));
  const total = positiveRows.reduce((sum, row) => sum + row.count, 0);

  if (!Number.isFinite(total) || total <= 0) return emptyBreakdown();

  const breakdownRows = positiveRows
    .sort(
      (a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key)
    )
    .map((row) => ({ ...row, share: row.count / total }));

  return { rows: breakdownRows, total };
}
