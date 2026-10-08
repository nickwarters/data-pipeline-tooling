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
 * @property {Leg[] | null} legs each lifecycle leg over the range's window
 * @property {OutcomeMix | null} outcomes
 * @property {RemediationQuestion[] | null} remediation the questions most
 *   often needing remediation, most first
 * @property {number[][] | null} posting messages by weekday (Monday first) and hour
 */

/**
 * One leg of the lifecycle — allocation, review, remediation, end to end —
 * summarised over a range. The percentiles arrive computed per window: a
 * median of months is not the median of the months' Cases, so the page never
 * derives one.
 *
 * @typedef {Object} Leg
 * @property {string} leg
 * @property {number} p50
 * @property {number} p90
 * @property {number} count
 */

/**
 * Outcomes by month. `order` is the Case Type's own vocabulary, best first,
 * which is what lets the page colour the best outcome blue and the worst red
 * without knowing any outcome's name.
 *
 * @typedef {Object} OutcomeMix
 * @property {{ outcome: string, label: string }[]} order
 * @property {{ month: string, counts: Record<string, number> }[]} months oldest first
 */

/**
 * @typedef {Object} RemediationQuestion
 * @property {string} questionId
 * @property {string} label
 * @property {number} caseCount
 * @property {number} share of the Case Type's current Cases
 */

const OVERDUE_BUCKETS = Object.freeze(['overdue_8_plus', 'overdue_1_7']);
/** The lifecycle legs, in the order a Case runs through them. */
const LEG_ORDER = Object.freeze([
  'allocation',
  'review',
  'remediation',
  'to_reportable',
  'end_to_end',
]);
const TOP_QUESTIONS = 8;
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
 * The lifecycle legs computed for this range's window, in lifecycle order; a
 * leg the page does not know goes last rather than being dropped.
 *
 * @param {ReportEnvelope} envelope
 * @param {string} range
 * @returns {Leg[] | null}
 */
function legsFor(envelope, range) {
  const rows = rowsOf(envelope, 'lifecycle_window');
  if (!rows) return null;
  /** @param {string} leg */
  const rank = (leg) => {
    const index = LEG_ORDER.indexOf(leg);
    return index === -1 ? LEG_ORDER.length : index;
  };
  const legs = rows
    .filter((row) => row?.window === range && typeof row.leg === 'string')
    .map((row) => ({
      leg: row.leg,
      p50: count(row.p50),
      p90: Math.max(count(row.p50), count(row.p90)),
      count: count(row.n),
    }))
    .sort((a, b) => rank(a.leg) - rank(b.leg));
  return legs.length > 0 ? legs : null;
}

/**
 * Outcomes per month for the range's last months. Needs the Case Type's
 * outcome order: without it the page cannot tell the best outcome from the
 * worst, and colouring them anyway would be a guess.
 *
 * @param {ReportEnvelope} envelope
 * @param {number} months
 * @returns {OutcomeMix | null}
 */
function outcomeMix(envelope, months) {
  const order = rowsOf(envelope, 'outcome_order');
  const rows = rowsOf(envelope, 'outcome_monthly');
  if (!order || !rows) return null;
  /** @type {Map<string, Record<string, number>>} */
  const byMonth = new Map();
  for (const row of rows) {
    if (typeof row?.month !== 'string' || typeof row.outcome !== 'string')
      continue;
    const counts = byMonth.get(row.month) ?? {};
    counts[row.outcome] = (counts[row.outcome] ?? 0) + count(row.count);
    byMonth.set(row.month, counts);
  }
  return {
    order: order
      .filter((entry) => typeof entry?.outcome === 'string')
      .map((entry) => ({
        outcome: entry.outcome,
        label: typeof entry.label === 'string' ? entry.label : entry.outcome,
      })),
    months: [...byMonth.keys()]
      .sort()
      .slice(-months)
      .map((month) => ({
        month,
        counts: /** @type {Record<string, number>} */ (byMonth.get(month)),
      })),
  };
}

/**
 * @param {ReportEnvelope} envelope
 * @returns {RemediationQuestion[] | null}
 */
function remediationQuestions(envelope) {
  const rows = rowsOf(envelope, 'remediation_questions');
  if (!rows) return null;
  return rows
    .filter((row) => typeof row?.question_id === 'string')
    .map((row) => ({
      questionId: row.question_id,
      label: typeof row.label === 'string' ? row.label : row.question_id,
      caseCount: count(row.case_count),
      share: count(row.share_of_cases),
    }))
    .sort((a, b) => b.share - a.share)
    .slice(0, TOP_QUESTIONS);
}

/**
 * Messages posted, as seven weekday rows (Monday first) of 24 hours. The feed
 * writes the whole grid, quiet cells included; a cell it omits reads as zero.
 *
 * @param {ReportEnvelope} envelope
 * @returns {number[][] | null}
 */
function postingGrid(envelope) {
  const rows = rowsOf(envelope, 'posting_pattern');
  if (!rows) return null;
  const grid = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 0)
  );
  for (const row of rows) {
    const day = row?.weekday_order;
    const hour = row?.hour_of_day;
    if (
      Number.isInteger(day) &&
      day >= 1 &&
      day <= 7 &&
      Number.isInteger(hour) &&
      hour >= 0 &&
      hour <= 23
    ) {
      grid[day - 1][hour] += count(row.message_count);
    }
  }
  return grid;
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
    legs: legsFor(envelope, rangeKey),
    outcomes: outcomeMix(envelope, window.months),
    remediation: remediationQuestions(envelope),
    posting: postingGrid(envelope),
  };
}
