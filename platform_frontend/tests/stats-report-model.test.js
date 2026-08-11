// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStatsReport,
  countCasesByLocalDateAndType,
} from '../src/evaluators/stats-report-model.js';
import { buildStatsRanges } from '../src/evaluators/stats-range-model.js';
import { shiftDateKey } from '../src/lib/local-calendar.js';

/**
 * @template T
 * @param {string} zone
 * @param {() => T} run
 * @returns {T}
 */
function inTimeZone(zone, run) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

/** @param {string} from @param {string} to @returns {string[]} */
function dateKeys(from, to) {
  /** @type {string[]} */
  const keys = [];
  for (let key = from; key <= to; key = shiftDateKey(key, 1)) keys.push(key);
  return keys;
}

/**
 * A day-grain range built the way `buildStatsRanges` builds one: totals stop at
 * `end`, the buckets tile `start` through `today`.
 *
 * @param {string} start
 * @param {string} today
 * @returns {import('../src/evaluators/stats-range-model.js').StatsRangeDescriptor}
 */
function dailyRange(start, today) {
  return {
    key: 'week',
    label: 'Week',
    grain: 'day',
    start,
    end: shiftDateKey(today, -1),
    today,
    buckets: dateKeys(start, today).map((key) => ({
      key,
      label: key,
      start: key,
      end: key,
    })),
  };
}

/** @param {string} date @param {number} count */
const feedRow = (date, count) => ({ date, case_type: 'complaints', count });

test('buildStatsReport: the report answers for its own days and the live read answers for the rest', () => {
  const report = buildStatsReport({
    range: dailyRange('2026-08-03', '2026-08-10'),
    completeThrough: '2026-08-07',
    feedRows: [feedRow('2026-08-03', 2), feedRow('2026-08-07', 5)],
    liveTypedCounts: {
      '2026-08-08': { complaints: 1 },
      '2026-08-10': { complaints: 3 },
    },
  });

  assert.deepEqual(
    report.buckets.map(({ key, settled, provisional }) => [
      key,
      settled,
      provisional,
    ]),
    [
      ['2026-08-03', 2, null],
      ['2026-08-04', 0, null],
      ['2026-08-05', 0, null],
      ['2026-08-06', 0, null],
      ['2026-08-07', 5, null],
      ['2026-08-08', null, 1],
      ['2026-08-09', null, 0],
      ['2026-08-10', null, 3],
    ]
  );
});

test('buildStatsReport: the file wins for every day it covers, whatever the live read says', () => {
  const report = buildStatsReport({
    range: dailyRange('2026-08-06', '2026-08-09'),
    completeThrough: '2026-08-07',
    feedRows: [feedRow('2026-08-07', 5)],
    // A live row landing inside the published window is the disagreement the
    // boundary exists to settle, and the published number is the one that wins.
    liveTypedCounts: {
      '2026-08-07': { complaints: 99 },
      '2026-08-08': { complaints: 1 },
    },
  });

  assert.deepEqual(
    report.buckets.map(({ settled, provisional }) => settled ?? provisional),
    [0, 5, 1, 0]
  );
});

test('buildStatsReport: a published row past the boundary is not counted twice', () => {
  const report = buildStatsReport({
    range: dailyRange('2026-08-07', '2026-08-09'),
    completeThrough: '2026-08-07',
    // The producer should not emit this row at all; if it does, the live read
    // already owns that day and the two must not be summed.
    feedRows: [feedRow('2026-08-07', 5), feedRow('2026-08-08', 40)],
    liveTypedCounts: { '2026-08-08': { complaints: 1 } },
  });

  assert.deepEqual(
    report.buckets.map(({ settled, provisional }) => settled ?? provisional),
    [5, 1, 0]
  );
});

test('buildStatsReport: with no published boundary every day is counted live', () => {
  const report = buildStatsReport({
    range: dailyRange('2026-08-08', '2026-08-09'),
    completeThrough: null,
    feedRows: [feedRow('2026-08-08', 40)],
    liveTypedCounts: { '2026-08-08': { complaints: 1 } },
  });

  assert.deepEqual(
    report.buckets.map(({ settled, provisional }) => [settled, provisional]),
    [
      [null, 1],
      [null, 0],
    ]
  );
});

test('buildStatsReport: duplicate and malformed published rows', () => {
  const report = buildStatsReport({
    range: dailyRange('2026-08-05', '2026-08-07'),
    completeThrough: '2026-08-07',
    feedRows: /** @type {any} */ ([
      feedRow('2026-08-05', 2),
      feedRow('2026-08-05', 3),
      { date: '2026-08-06', case_type: 'complaints', count: 'four' },
      { case_type: 'complaints', count: 4 },
      null,
    ]),
  });

  assert.deepEqual(
    report.buckets.map(({ settled }) => settled),
    [5, 0, 0]
  );
});

test('buildStatsReport: rows that are not an array at all', () => {
  const report = buildStatsReport({
    range: dailyRange('2026-08-06', '2026-08-07'),
    completeThrough: '2026-08-07',
    feedRows: /** @type {any} */ ('nonsense'),
  });

  assert.deepEqual(
    report.buckets.map(({ settled }) => settled),
    [0, 0]
  );
});

test('buildStatsReport: the total stops at yesterday', () => {
  const report = buildStatsReport({
    range: dailyRange('2026-08-03', '2026-08-10'),
    completeThrough: '2026-08-07',
    feedRows: [feedRow('2026-08-03', 2), feedRow('2026-08-07', 5)],
    liveTypedCounts: {
      '2026-08-09': { complaints: 4 },
      '2026-08-10': { complaints: 300 },
    },
  });

  assert.equal(report.headline.total, 11);
});

test('buildStatsReport: the average divides by working days, weekends and bank holidays removed', () => {
  const report = buildStatsReport({
    // 24 Aug to 4 Sep 2026 holds ten weekdays, one of which — Monday 31 August
    // — is the summer bank holiday, leaving nine working days.
    range: dailyRange('2026-08-24', '2026-09-05'),
    completeThrough: '2026-09-04',
    feedRows: [feedRow('2026-08-24', 9), feedRow('2026-08-29', 9)],
  });

  assert.equal(report.headline.total, 18);
  assert.equal(report.headline.workingDays, 9);
  assert.equal(report.headline.averagePerWorkingDay, 2);
});

test('buildStatsReport: the holiday list is replaceable, and an empty one leaves ten weekdays', () => {
  const report = buildStatsReport({
    range: dailyRange('2026-08-24', '2026-09-05'),
    completeThrough: '2026-09-04',
    feedRows: [feedRow('2026-08-24', 10)],
    holidays: [],
  });

  assert.equal(report.headline.workingDays, 10);
  assert.equal(report.headline.averagePerWorkingDay, 1);
});

test('buildStatsReport: a totals window with no working day has no average', () => {
  const report = buildStatsReport({
    // Saturday and Sunday only.
    range: dailyRange('2026-08-08', '2026-08-10'),
    completeThrough: '2026-08-09',
    feedRows: [feedRow('2026-08-08', 3)],
  });

  assert.equal(report.headline.workingDays, 0);
  assert.equal(report.headline.averagePerWorkingDay, null);
  assert.equal(report.headline.total, 3);
});

test('buildStatsReport: active days count days with work, from either provenance', () => {
  const report = buildStatsReport({
    range: dailyRange('2026-08-03', '2026-08-10'),
    completeThrough: '2026-08-07',
    feedRows: [feedRow('2026-08-03', 2), feedRow('2026-08-05', 0)],
    liveTypedCounts: {
      '2026-08-08': { complaints: 1 },
      '2026-08-10': { complaints: 9 },
    },
  });

  // 3 Aug published and 8 Aug live; 5 Aug is a published zero and today's nine
  // is outside the totals window.
  assert.equal(report.headline.activeDays, 2);
});

test('buildStatsReport: the busiest day names its date and count, earliest first on a tie', () => {
  const report = buildStatsReport({
    range: dailyRange('2026-08-03', '2026-08-10'),
    completeThrough: '2026-08-09',
    feedRows: [
      feedRow('2026-08-04', 7),
      feedRow('2026-08-06', 7),
      feedRow('2026-08-05', 3),
    ],
  });

  assert.deepEqual(report.headline.busiestDay, {
    date: '2026-08-04',
    count: 7,
  });
});

test('buildStatsReport: an empty range has no busiest day', () => {
  const report = buildStatsReport({
    range: dailyRange('2026-08-03', '2026-08-10'),
    completeThrough: '2026-08-09',
  });

  assert.equal(report.headline.busiestDay, null);
  assert.equal(report.headline.total, 0);
  assert.equal(report.headline.activeDays, 0);
});

test('buildStatsReport: a monthly bucket can hold both provenances at once', () => {
  const ranges = buildStatsRanges(new Date(2026, 7, 10, 12));
  const threeMonths = /** @type {any} */ (
    ranges.find(({ key }) => key === '3-months')
  );

  const report = buildStatsReport({
    range: threeMonths,
    completeThrough: '2026-08-07',
    feedRows: [feedRow('2026-06-15', 4), feedRow('2026-08-03', 6)],
    liveTypedCounts: {
      '2026-08-08': { complaints: 2 },
      '2026-08-10': { complaints: 1 },
    },
  });
  const august = report.buckets[report.buckets.length - 1];

  assert.equal(report.buckets.length, 4);
  assert.equal(august.key, '2026-08');
  assert.equal(august.settled, 6);
  assert.equal(august.provisional, 3);
  assert.deepEqual(
    report.buckets
      .slice(0, 3)
      .map(({ settled, provisional }) => [settled, provisional]),
    [
      [0, null],
      [4, null],
      [0, null],
    ]
  );
});

test('buildStatsReport: the range travels with the report so one derivation feeds all readings', () => {
  const range = dailyRange('2026-08-09', '2026-08-10');
  assert.equal(buildStatsReport({ range }).range, range);
});

test('countCasesByLocalDateAndType: an instant is counted on the Reviewer’s own day', () => {
  const rows = /** @type {any} */ ([
    {
      id: '1',
      reportableAt: '2026-08-10T23:30:00.000Z',
      caseType: 'complaints',
    },
    {
      id: '2',
      reportableAt: '2026-08-10T00:30:00.000Z',
      caseType: 'complaints',
    },
    {
      id: '3',
      reportableAt: new Date('2026-08-10T23:45:00.000Z'),
      caseType: 'complaints',
    },
  ]);

  assert.deepEqual(
    inTimeZone('Asia/Tokyo', () => countCasesByLocalDateAndType(rows)),
    { '2026-08-11': { complaints: 2 }, '2026-08-10': { complaints: 1 } }
  );
  assert.deepEqual(
    inTimeZone('America/Los_Angeles', () => countCasesByLocalDateAndType(rows)),
    { '2026-08-10': { complaints: 2 }, '2026-08-09': { complaints: 1 } }
  );
  assert.deepEqual(
    inTimeZone('Pacific/Kiritimati', () => countCasesByLocalDateAndType(rows)),
    { '2026-08-11': { complaints: 2 }, '2026-08-10': { complaints: 1 } }
  );
  assert.deepEqual(
    inTimeZone('Pacific/Midway', () => countCasesByLocalDateAndType(rows)),
    { '2026-08-10': { complaints: 2 }, '2026-08-09': { complaints: 1 } }
  );
});

test('countCasesByLocalDateAndType: a row that cannot be placed on a day is left out', () => {
  const rows = /** @type {any} */ ([
    { id: '1' },
    { id: '2', reportableAt: null },
    { id: '3', reportableAt: '' },
    null,
  ]);

  assert.deepEqual(
    inTimeZone('Europe/London', () => countCasesByLocalDateAndType(rows)),
    {}
  );
  assert.deepEqual(
    countCasesByLocalDateAndType(/** @type {any} */ (undefined)),
    {}
  );
});

test('buildStatsReport: typed feed and live counts share global columns and bucket percentages', () => {
  const report = buildStatsReport({
    range: dailyRange('2026-08-08', '2026-08-10'),
    completeThrough: '2026-08-08',
    feedRows: [
      feedRow('2026-08-08', 2),
      { date: '2026-08-08', case_type: 'example-case-type', count: 1 },
    ],
    liveTypedCounts: {
      '2026-08-09': { 'example-case-type': 1 },
      '2026-08-10': { complaints: 3 },
    },
  });

  assert.deepEqual(
    report.caseTypes.map(({ key }) => key),
    ['complaints', 'example-case-type']
  );
  assert.equal(report.buckets[0].total, 3);
  assert.deepEqual(
    report.buckets[0].caseTypes.map(({ key, count, percentage }) => [
      key,
      count,
      percentage,
    ]),
    [
      ['complaints', 2, (2 / 3) * 100],
      ['example-case-type', 1, (1 / 3) * 100],
    ]
  );
  assert.deepEqual(
    report.buckets[1].caseTypes.map(({ count, percentage }) => [
      count,
      percentage,
    ]),
    [
      [0, 0],
      [1, 100],
    ]
  );
  assert.equal(report.buckets[2].total, 3);
});

test('countCasesByLocalDateAndType preserves the live Case Type dimension', () => {
  assert.deepEqual(
    countCasesByLocalDateAndType([
      { reportableAt: new Date(2026, 7, 10, 9), caseType: 'complaints' },
      { reportableAt: new Date(2026, 7, 10, 10), caseType: 'complaints' },
      {
        reportableAt: new Date(2026, 7, 10, 11),
        caseType: 'example-case-type',
      },
    ]),
    {
      '2026-08-10': { complaints: 2, 'example-case-type': 1 },
    }
  );
});
