// @ts-check

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const SHORT_MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** @typedef {'week' | 'month' | '3-months' | '12-months'} StatsRangeKey */
/** @typedef {'day' | 'month'} StatsRangeGrain */

/**
 * One inclusive local-calendar period within a stats range. Daily keys are
 * `YYYY-MM-DD`; monthly keys are `YYYY-MM`.
 *
 * @typedef {Object} StatsBucket
 * @property {string} key
 * @property {string} label
 * @property {string} start - Inclusive local calendar date (`YYYY-MM-DD`).
 * @property {string} end - Inclusive local calendar date (`YYYY-MM-DD`).
 */

/**
 * A range snapshot for the My Stats page. `end` is the inclusive totals cutoff
 * at yesterday; `today` is the inclusive display endpoint, and the final bucket
 * deliberately extends through it.
 *
 * @typedef {Object} StatsRangeDescriptor
 * @property {StatsRangeKey} key
 * @property {'Week' | 'Month' | '3 months' | '12 months'} label
 * @property {StatsRangeGrain} grain
 * @property {string} start - Inclusive local calendar date (`YYYY-MM-DD`).
 * @property {string} end - Inclusive totals cutoff (`YYYY-MM-DD`).
 * @property {string} today - Inclusive display endpoint (`YYYY-MM-DD`).
 * @property {StatsBucket[]} buckets
 */

/**
 * Create a UTC-anchored carrier for a date-only calendar value. UTC field
 * arithmetic keeps calendar steps independent of local DST transitions.
 *
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @returns {Date}
 */
function calendarDate(year, month, day) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month, day);
  return date;
}

/** @param {Date} date @param {number} days @returns {Date} */
function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** @param {Date} date @param {number} months @returns {Date} */
function monthStart(date, months = 0) {
  return calendarDate(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
}

/** @param {number} value @returns {string} */
function twoDigits(value) {
  return String(value).padStart(2, '0');
}

/** @param {Date} date @returns {string} */
function dateKey(date) {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${twoDigits(
    date.getUTCMonth() + 1
  )}-${twoDigits(date.getUTCDate())}`;
}

/** @param {Date} date @returns {string} */
function monthKey(date) {
  return dateKey(date).slice(0, 7);
}

/**
 * @param {Date} start
 * @param {Date} today
 * @returns {StatsBucket[]}
 */
function dailyBuckets(start, today) {
  /** @type {StatsBucket[]} */
  const buckets = [];
  for (let date = start; date <= today; date = addDays(date, 1)) {
    const key = dateKey(date);
    const isToday = key === dateKey(today);
    buckets.push({
      key,
      label: `${SHORT_MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}${
        isToday ? ' (today)' : ''
      }`,
      start: key,
      end: key,
    });
  }
  return buckets;
}

/**
 * @param {Date} today
 * @param {number} completeMonths
 * @returns {StatsBucket[]}
 */
function monthlyBuckets(today, completeMonths) {
  const currentMonth = monthStart(today);
  /** @type {StatsBucket[]} */
  const buckets = [];
  for (let offset = -completeMonths; offset <= 0; offset += 1) {
    const start = monthStart(currentMonth, offset);
    const isCurrent = offset === 0;
    buckets.push({
      key: monthKey(start),
      label: `${MONTH_NAMES[start.getUTCMonth()]}${
        isCurrent ? ' (current month)' : ''
      }`,
      start: dateKey(start),
      end: dateKey(isCurrent ? today : addDays(monthStart(start, 1), -1)),
    });
  }
  return buckets;
}

/**
 * Build the four My Stats ranges from one snapshot of the browser-local
 * calendar date. Calendar values are returned as date-only strings; no time or
 * timezone survives into the public contract.
 *
 * The ordered result is always Week, Month, 3 months, and 12 months. Week and
 * Month use daily buckets; 3 months and 12 months use monthly buckets. Every
 * range includes complete previous period(s) plus the current partial period
 * through today, while its totals cutoff remains yesterday.
 *
 * @param {Date} [now]
 * @returns {StatsRangeDescriptor[]}
 * @throws {TypeError} When `now` is not a valid Date.
 */
export function buildStatsRanges(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }

  const today = calendarDate(now.getFullYear(), now.getMonth(), now.getDate());
  const end = addDays(today, -1);
  const common = { end: dateKey(end), today: dateKey(today) };

  const currentMonday = addDays(today, -((today.getUTCDay() + 6) % 7));
  const previousMonday = addDays(currentMonday, -7);
  const previousMonth = monthStart(today, -1);
  const threeMonthStart = monthStart(today, -3);
  const twelveMonthStart = monthStart(today, -12);

  return [
    {
      key: 'week',
      label: 'Week',
      grain: 'day',
      start: dateKey(previousMonday),
      ...common,
      buckets: dailyBuckets(previousMonday, today),
    },
    {
      key: 'month',
      label: 'Month',
      grain: 'day',
      start: dateKey(previousMonth),
      ...common,
      buckets: dailyBuckets(previousMonth, today),
    },
    {
      key: '3-months',
      label: '3 months',
      grain: 'month',
      start: dateKey(threeMonthStart),
      ...common,
      buckets: monthlyBuckets(today, 3),
    },
    {
      key: '12-months',
      label: '12 months',
      grain: 'month',
      start: dateKey(twelveMonthStart),
      ...common,
      buckets: monthlyBuckets(today, 12),
    },
  ];
}
