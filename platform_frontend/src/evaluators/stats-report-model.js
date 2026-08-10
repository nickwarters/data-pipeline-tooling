// @ts-check

import { ENGLAND_WALES_HOLIDAYS } from '../config/working-days.js';
import {
  shiftDateKey,
  toLocalDateKey,
  weekdayOfDateKey,
} from '../lib/local-calendar.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../evaluators/stats-range-model.js').StatsRangeDescriptor} StatsRangeDescriptor */
/** @typedef {import('../services/report-feed-loader.js').ReportFeedEnvelope['rows'][number]} ReportFeedRow */

/**
 * One day of the range, with where its number came from. `settled` is
 * provenance, not a judgement: a settled day was published in the Report Feed,
 * an unsettled one was counted in the browser just now. Neither means
 * "excluded".
 *
 * @typedef {Object} StatsDay
 * @property {string} date `YYYY-MM-DD`, browser-local
 * @property {number} count
 * @property {boolean} settled
 */

/**
 * One chart group. A bucket holds a `settled` total when any of its days came
 * from the file and a `provisional` total when any came from the live read;
 * `null` means that provenance contributes no days at all, so the chart draws
 * no bar rather than a zero. A daily bucket is one or the other. The current
 * month is both.
 *
 * @typedef {Object} StatsReportBucket
 * @property {string} key
 * @property {string} label
 * @property {number | null} settled
 * @property {number | null} provisional
 */

/**
 * The four headline figures, all measured over the range's totals window —
 * `start` through `end`, where `end` is yesterday. Today is in the chart and
 * not in these numbers.
 *
 * @typedef {Object} StatsHeadline
 * @property {number} total
 * @property {number} workingDays
 * @property {number | null} averagePerWorkingDay null when the window holds no
 *   working day at all, which is the only case where the division has no answer
 * @property {number} activeDays
 * @property {{ date: string, count: number } | null} busiestDay
 */

/**
 * @typedef {Object} StatsReport
 * @property {StatsRangeDescriptor} range
 * @property {StatsReportBucket[]} buckets
 * @property {StatsHeadline} headline
 */

/**
 * Count live Case rows into browser-local calendar days.
 *
 * The rows are whatever the live read returned; a row with no usable
 * `reportableAt` instant cannot be placed on a day and is left out rather than
 * guessed at.
 *
 * @param {CaseRow[]} rows
 * @returns {Record<string, number>} browser-local date key to count
 */
export function countCasesByLocalDate(rows) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const row of rows ?? []) {
    const dateKey = toLocalDateKey(row?.reportableAt);
    if (dateKey === null) continue;
    counts[dateKey] = (counts[dateKey] ?? 0) + 1;
  }
  return counts;
}

/**
 * @param {ReportFeedRow[]} rows
 * @returns {Map<string, number>}
 */
function feedTotalsByDate(rows) {
  /** @type {Map<string, number>} */
  const totals = new Map();
  if (!Array.isArray(rows)) return totals;
  for (const row of rows) {
    if (
      typeof row?.date !== 'string' ||
      typeof row.count !== 'number' ||
      !Number.isFinite(row.count)
    ) {
      continue;
    }
    totals.set(row.date, (totals.get(row.date) ?? 0) + row.count);
  }
  return totals;
}

/**
 * Every calendar date from `from` through `to`, inclusive.
 *
 * @param {string} from
 * @param {string} to
 * @returns {string[]}
 */
function dateKeysBetween(from, to) {
  /** @type {string[]} */
  const keys = [];
  for (let key = from; key <= to; key = shiftDateKey(key, 1)) keys.push(key);
  return keys;
}

/**
 * Build the whole page's numbers once, from the two sources that answer for
 * different halves of the range.
 *
 * `completeThrough` is the entire boundary between them: a date at or before it
 * is answered by the file, a date after it is answered by the live read. One
 * comparison decides both sides, so the two paths cannot overlap, cannot both
 * claim a day, and cannot leave one unclaimed. The file wins wherever it
 * reaches, even though the live read could often produce the same day — that is
 * what stops the page from ever showing two different numbers for one date.
 *
 * @param {{
 *   range: StatsRangeDescriptor,
 *   completeThrough?: string | null,
 *   feedRows?: ReportFeedRow[],
 *   liveCounts?: Record<string, number>,
 *   holidays?: readonly string[],
 * }} input
 * @returns {StatsReport}
 */
export function buildStatsReport({
  range,
  completeThrough = null,
  feedRows = [],
  liveCounts = {},
  holidays = ENGLAND_WALES_HOLIDAYS,
}) {
  const settledTotals = feedTotalsByDate(feedRows);
  /** @param {string} dateKey */
  const isSettled = (dateKey) =>
    typeof completeThrough === 'string' && dateKey <= completeThrough;

  // The display window, `start` through `today`, is the widest thing the page
  // shows. The buckets tile it exactly and the totals window is its leading
  // part, so both readings below can look every date up and find it.
  /** @type {Map<string, StatsDay>} */
  const days = new Map();
  for (const date of dateKeysBetween(range.start, range.today)) {
    const settled = isSettled(date);
    const count = (settled ? settledTotals.get(date) : liveCounts[date]) ?? 0;
    days.set(date, { date, count, settled });
  }
  /** @param {string} date @returns {StatsDay} */
  const dayOf = (date) => /** @type {StatsDay} */ (days.get(date));

  return {
    range,
    buckets: range.buckets.map((bucket) => {
      /** @type {number | null} */
      let settled = null;
      /** @type {number | null} */
      let provisional = null;
      for (const date of dateKeysBetween(bucket.start, bucket.end)) {
        const day = dayOf(date);
        if (day.settled) settled = (settled ?? 0) + day.count;
        else provisional = (provisional ?? 0) + day.count;
      }
      return { key: bucket.key, label: bucket.label, settled, provisional };
    }),
    headline: buildHeadline(
      dateKeysBetween(range.start, range.end).map(dayOf),
      holidays
    ),
  };
}

/**
 * The four figures, from the days of the totals window.
 *
 * The average is deliberately inconsistent with its own numerator and says so
 * out loud on the page: the total counts every day including weekends, while
 * the divisor counts working days only, and neither of them knows when the
 * Reviewer was on leave. That makes the figure comparable between people and
 * exact for nobody, which is the right trade for "roughly how am I doing" — and
 * it is why **Active days** sits beside it, being the one figure leave cannot
 * distort.
 *
 * @param {StatsDay[]} days
 * @param {readonly string[]} holidays
 * @returns {StatsHeadline}
 */
function buildHeadline(days, holidays) {
  const holidaySet = new Set(holidays);
  let total = 0;
  let activeDays = 0;
  let workingDays = 0;
  /** @type {{ date: string, count: number } | null} */
  let busiestDay = null;

  for (const day of days) {
    total += day.count;
    if (day.count > 0) activeDays += 1;
    const weekday = weekdayOfDateKey(day.date);
    if (weekday !== 0 && weekday !== 6 && !holidaySet.has(day.date)) {
      workingDays += 1;
    }
    // Strictly greater, walking forward in date order, so a tie is won by the
    // earlier day rather than by whichever one happened to be read last.
    if (
      day.count > 0 &&
      (busiestDay === null || day.count > busiestDay.count)
    ) {
      busiestDay = { date: day.date, count: day.count };
    }
  }

  return {
    total,
    workingDays,
    averagePerWorkingDay: workingDays > 0 ? total / workingDays : null,
    activeDays,
    busiestDay,
  };
}
