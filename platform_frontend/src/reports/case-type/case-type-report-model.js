// @ts-check
import { shiftDateKey } from '../../lib/local-calendar.js';

/** @typedef {import('../contract.js').ReportEnvelope} ReportEnvelope */

/**
 * The Case Type report's numbers, taken out of its feed. No DOM and no
 * formatting: what the page shows is decided in the view, and this module
 * only answers "what are the figures for this range".
 *
 * Every dataset is optional. A feed published before a dataset existed simply
 * lacks it, and the figure built from it comes back `null` so the view can
 * leave that panel out — which lets the page ship ahead of the pipeline
 * change that fills it, rather than the two having to land together.
 */

/** The ranges the report offers, measured back from the feed's last day. */
export const RANGES = Object.freeze({
  '3m': { label: '3 months', days: 91, weeks: 13, months: 3 },
  '6m': { label: '6 months', days: 182, weeks: 26, months: 6 },
  '12m': { label: '12 months', days: 365, weeks: 52, months: 12 },
});

/** @typedef {keyof typeof RANGES} RangeKey */

/**
 * @typedef {Object} BacklogDay
 * @property {string} date
 * @property {number} toAllocate
 * @property {number} inProgress
 * @property {number} actionsInProgress
 * @property {number} open
 */

/**
 * @typedef {Object} DueBucket
 * @property {string} bucket
 * @property {number} count
 * @property {number} onHold
 */

/**
 * @typedef {Object} FlowWeek
 * @property {string} weekEnding
 * @property {number} arrived
 * @property {number} completed
 */

/**
 * @typedef {Object} SlaMonth
 * @property {string} month `YYYY-MM`
 * @property {number} completed
 * @property {number} onTime
 * @property {number} late
 * @property {number} share on time, over the Cases that had a due date
 */

/**
 * @typedef {Object} Change
 * @property {number} now
 * @property {number | null} before the value 30 days earlier, if the feed reaches back that far
 */

/**
 * @typedef {Object} CaseTypeReportModel
 * @property {RangeKey} range
 * @property {string | null} completeThrough
 * @property {Change | null} open
 * @property {number[] | null} openTrend weekly, the last 13 weeks
 * @property {Change | null} toAllocate
 * @property {number | null} overdue
 * @property {DueBucket[] | null} due
 * @property {BacklogDay | null} latest
 * @property {BacklogDay[] | null} backlog the range, oldest first
 * @property {FlowWeek[] | null} flow
 * @property {SlaMonth[] | null} sla the range's complete months, oldest first
 * @property {number | null} slaTarget
 */

const OVERDUE_BUCKETS = Object.freeze(['overdue_8_plus', 'overdue_1_7']);
const COMPARE_DAYS = 30;
const TREND_WEEKS = 13;

/**
 * @param {unknown} value
 * @returns {number}
 */
function count(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * The rows of a dataset, or null when the feed does not carry it.
 *
 * @param {ReportEnvelope} envelope
 * @param {string} name
 * @returns {any[] | null}
 */
function rowsOf(envelope, name) {
  const rows = envelope.datasets[name];
  return Array.isArray(rows) && rows.length > 0 ? rows : null;
}

/**
 * @param {ReportEnvelope} envelope
 * @returns {BacklogDay[] | null}
 */
function backlogDays(envelope) {
  const rows = rowsOf(envelope, 'backlog_daily');
  if (!rows) return null;
  return rows
    .filter((row) => typeof row?.date === 'string')
    .map((row) => {
      const toAllocate = count(row.to_allocate);
      const inProgress = count(row.in_progress);
      const actionsInProgress = count(row.actions_in_progress);
      return {
        date: row.date,
        toAllocate,
        inProgress,
        actionsInProgress,
        open: toAllocate + inProgress + actionsInProgress,
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * @param {BacklogDay[]} days
 * @param {(day: BacklogDay) => number} pick
 * @returns {Change}
 */
function change(days, pick) {
  const latest = days[days.length - 1];
  const earlier = days.find(
    (day) => day.date === shiftDateKey(latest.date, -COMPARE_DAYS)
  );
  return { now: pick(latest), before: earlier ? pick(earlier) : null };
}

/**
 * The open count once a week for the last thirteen weeks, ending on the latest
 * day — the shape of the backlog, sampled sparsely enough for a sparkline.
 * Null when the feed is too short to show a direction at all.
 *
 * @param {BacklogDay[]} days
 * @returns {number[] | null}
 */
function weeklyTrend(days) {
  const samples = days
    .slice(-(TREND_WEEKS * 7 + 1))
    .filter((_, i, all) => (all.length - 1 - i) % 7 === 0)
    .map((day) => day.open);
  return samples.length >= 2 ? samples : null;
}

/**
 * Seven-day totals for the weeks ending on the feed's last day, oldest first.
 * Days the feed has no row for count as zero — a day with no arrivals is a
 * real zero, and the pipeline writes the window whole.
 *
 * @param {ReportEnvelope} envelope
 * @param {string} lastDay
 * @param {number} weeks
 * @returns {FlowWeek[] | null}
 */
function flowWeeks(envelope, lastDay, weeks) {
  const rows = rowsOf(envelope, 'flow_daily');
  if (!rows) return null;
  /** @type {Map<string, { arrived: number, completed: number }>} */
  const byDate = new Map();
  for (const row of rows) {
    if (typeof row?.date === 'string') {
      byDate.set(row.date, {
        arrived: count(row.arrived),
        completed: count(row.completed),
      });
    }
  }
  /** @type {FlowWeek[]} */
  const result = [];
  for (let week = weeks - 1; week >= 0; week--) {
    const weekEnding = shiftDateKey(lastDay, -7 * week);
    let arrived = 0;
    let completed = 0;
    for (let day = 0; day < 7; day++) {
      const totals = byDate.get(shiftDateKey(weekEnding, -day));
      arrived += totals?.arrived ?? 0;
      completed += totals?.completed ?? 0;
    }
    result.push({ weekEnding, arrived, completed });
  }
  return result;
}

/**
 * The review SLA by month completed, over the months with something to judge.
 * A Case with no due date was judged neither way, so it is left out of the
 * share rather than counted as late or on time.
 *
 * @param {ReportEnvelope} envelope
 * @returns {SlaMonth[] | null}
 */
function slaMonths(envelope) {
  const rows = rowsOf(envelope, 'sla_monthly');
  if (!rows) return null;
  const months = rows
    .filter((row) => typeof row?.month === 'string')
    .map((row) => {
      const onTime = count(row.on_time_count);
      const late = count(row.late_count);
      return {
        month: row.month,
        completed: count(row.case_count),
        onTime,
        late,
        share: onTime + late > 0 ? onTime / (onTime + late) : NaN,
      };
    })
    .filter((month) => Number.isFinite(month.share))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
  return months.length > 0 ? months : null;
}

/**
 * @param {ReportEnvelope} envelope
 * @param {string} range
 * @returns {CaseTypeReportModel}
 */
export function buildCaseTypeReport(envelope, range) {
  const rangeKey = /** @type {RangeKey} */ (range in RANGES ? range : '6m');
  const window = RANGES[rangeKey];
  const days = backlogDays(envelope);
  const latest = days ? days[days.length - 1] : null;
  const lastDay =
    typeof envelope.complete_through === 'string'
      ? envelope.complete_through
      : (latest?.date ?? null);

  const dueRows = rowsOf(envelope, 'due_profile');
  const due = dueRows
    ? dueRows
        .filter((row) => typeof row?.bucket === 'string')
        .sort((a, b) => count(a.order) - count(b.order))
        .map((row) => ({
          bucket: row.bucket,
          count: count(row.count),
          onHold: count(row.on_hold),
        }))
    : null;

  const sla = slaMonths(envelope);
  const target = envelope.datasets.targets?.review_on_time;

  return {
    range: rangeKey,
    completeThrough: lastDay,
    open: days ? change(days, (day) => day.open) : null,
    openTrend: days ? weeklyTrend(days) : null,
    toAllocate: days ? change(days, (day) => day.toAllocate) : null,
    overdue: due
      ? due
          .filter((row) => OVERDUE_BUCKETS.includes(row.bucket))
          .reduce((sum, row) => sum + row.count, 0)
      : null,
    due,
    latest,
    backlog: days ? days.slice(-window.days) : null,
    flow: lastDay ? flowWeeks(envelope, lastDay, window.weeks) : null,
    sla: sla ? sla.slice(-window.months) : null,
    slaTarget:
      typeof target === 'number' && Number.isFinite(target) ? target : null,
  };
}
