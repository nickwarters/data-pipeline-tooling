// @ts-check
import { shiftDateKey } from '../../lib/local-calendar.js';

/** @typedef {import('../contract.js').ReportEnvelope} ReportEnvelope */

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
 * @property {number} share
 */

/**
 * @typedef {Object} Change
 * @property {number} now
 * @property {number | null} before 30 days earlier
 */

/**
 * @typedef {Object} CaseTypeReportModel
 * @property {RangeKey} range
 * @property {string | null} completeThrough
 * @property {Change | null} open
 * @property {number[] | null} openTrend weekly, last 13 weeks
 * @property {Change | null} toAllocate
 * @property {number | null} overdue
 * @property {DueBucket[] | null} due
 * @property {BacklogDay | null} latest
 * @property {BacklogDay[] | null} backlog oldest first
 * @property {FlowWeek[] | null} flow
 * @property {SlaMonth[] | null} sla oldest first
 * @property {number | null} slaTarget
 * @property {Leg[] | null} legs
 * @property {OutcomeMix | null} outcomes
 * @property {RemediationQuestion[] | null} remediation
 * @property {number[][] | null} posting Monday-first weekday by hour
 */

/**
 * @typedef {Object} Leg
 * @property {string} leg
 * @property {number} p50
 * @property {number} p90
 * @property {number} count
 */

/**
 * @typedef {Object} OutcomeMix
 * @property {{ outcome: string, label: string }[]} order
 * @property {{ month: string, counts: Record<string, number> }[]} months oldest first
 */

/**
 * @typedef {Object} RemediationQuestion
 * @property {string} questionId
 * @property {string} label
 * @property {number} caseCount
 * @property {number} share
 */

const OVERDUE_BUCKETS = Object.freeze(['overdue_8_plus', 'overdue_1_7']);
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
