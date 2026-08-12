// @ts-check
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStatsRanges } from '../src/evaluators/stats-range-model.js';

/** @param {number} year @param {number} month @param {number} day */
function localDate(year, month, day) {
  return new Date(year, month - 1, day, 12);
}

test('stats ranges expose the four ordered range descriptors', () => {
  const ranges = buildStatsRanges(localDate(2026, 8, 12));

  assert.deepEqual(
    ranges.map(({ key, grain, start, end, today }) => ({
      key,
      grain,
      start,
      end,
      today,
    })),
    [
      {
        key: 'week',
        grain: 'day',
        start: '2026-08-03',
        end: '2026-08-11',
        today: '2026-08-12',
      },
      {
        key: 'month',
        grain: 'day',
        start: '2026-07-01',
        end: '2026-08-11',
        today: '2026-08-12',
      },
      {
        key: '3-months',
        grain: 'month',
        start: '2026-05-01',
        end: '2026-08-11',
        today: '2026-08-12',
      },
      {
        key: '12-months',
        grain: 'month',
        start: '2025-08-01',
        end: '2026-08-11',
        today: '2026-08-12',
      },
    ]
  );
  const labels = ranges.map(({ label }) => label);
  assert.ok(labels.every((label) => label.trim().length > 0));
  assert.equal(new Set(labels).size, ranges.length);
});

test('week contains eight daily buckets on Monday', () => {
  const [week] = buildStatsRanges(localDate(2026, 8, 10));

  assert.equal(week.buckets.length, 8);
  assert.deepEqual(week.buckets[0], {
    key: '2026-08-03',
    label: 'Aug 3',
    start: '2026-08-03',
    end: '2026-08-03',
  });
  assert.deepEqual(week.buckets.at(-1), {
    key: '2026-08-10',
    label: 'Aug 10 (today)',
    start: '2026-08-10',
    end: '2026-08-10',
  });
});

test('week contains fourteen daily buckets on Sunday', () => {
  const [week] = buildStatsRanges(localDate(2026, 8, 9));

  assert.equal(week.start, '2026-07-27');
  assert.equal(week.buckets.length, 14);
  assert.deepEqual(week.buckets.at(-1), {
    key: '2026-08-09',
    label: 'Aug 9 (today)',
    start: '2026-08-09',
    end: '2026-08-09',
  });
});

test('month includes a complete leap February and the first current day', () => {
  const month = buildStatsRanges(localDate(2024, 3, 1))[1];

  assert.equal(month.start, '2024-02-01');
  assert.equal(month.end, '2024-02-29');
  assert.equal(month.buckets.length, 30);
  assert.equal(month.buckets.at(-2)?.key, '2024-02-29');
  assert.equal(month.buckets.at(-1)?.label, 'Mar 1 (today)');
});

test('month includes a complete non-leap February and the first current day', () => {
  const month = buildStatsRanges(localDate(2025, 3, 1))[1];

  assert.equal(month.start, '2025-02-01');
  assert.equal(month.end, '2025-02-28');
  assert.equal(month.buckets.length, 29);
  assert.equal(month.buckets.at(-2)?.key, '2025-02-28');
});

test('month runs through the last day of the current month', () => {
  const month = buildStatsRanges(localDate(2026, 4, 30))[1];

  assert.equal(month.start, '2026-03-01');
  assert.equal(month.end, '2026-04-29');
  assert.equal(month.buckets.length, 61);
  assert.deepEqual(month.buckets.at(-1), {
    key: '2026-04-30',
    label: 'Apr 30 (today)',
    start: '2026-04-30',
    end: '2026-04-30',
  });
});

test('monthly ranges have stable keys and complete boundaries across a year rollover', () => {
  const ranges = buildStatsRanges(localDate(2026, 1, 15));
  const threeMonths = ranges[2];
  const twelveMonths = ranges[3];

  assert.equal(threeMonths.buckets.length, 4);
  assert.deepEqual(threeMonths.buckets, [
    {
      key: '2025-10',
      label: 'October',
      start: '2025-10-01',
      end: '2025-10-31',
    },
    {
      key: '2025-11',
      label: 'November',
      start: '2025-11-01',
      end: '2025-11-30',
    },
    {
      key: '2025-12',
      label: 'December',
      start: '2025-12-01',
      end: '2025-12-31',
    },
    {
      key: '2026-01',
      label: 'January (current month)',
      start: '2026-01-01',
      end: '2026-01-15',
    },
  ]);
  assert.equal(twelveMonths.buckets.length, 13);
  assert.equal(twelveMonths.buckets[0]?.key, '2025-01');
  assert.equal(twelveMonths.buckets[0]?.end, '2025-01-31');
  assert.equal(twelveMonths.buckets.at(-1)?.key, '2026-01');
  assert.equal(twelveMonths.buckets.at(-1)?.end, '2026-01-15');
});

test('every range distinguishes the totals cutoff from the display endpoint', () => {
  const ranges = buildStatsRanges(localDate(2026, 8, 9));

  for (const range of ranges) {
    assert.equal(range.end, '2026-08-08');
    assert.equal(range.today, '2026-08-09');
    assert.equal(range.buckets.at(-1)?.end, range.today);
  }
});

test('bucket keys are unique and chronological', () => {
  const ranges = buildStatsRanges(localDate(2026, 8, 12));

  for (const range of ranges) {
    const keys = range.buckets.map(({ key }) => key);
    assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual(keys, [...keys].sort());
  }
});

test('daily calendar stepping remains consecutive across DST changes', () => {
  const moduleUrl = new URL(
    '../src/evaluators/stats-range-model.js',
    import.meta.url
  ).href;
  const script = `
    import { buildStatsRanges } from ${JSON.stringify(moduleUrl)};
    const weekKeys = (date) => buildStatsRanges(date)[0].buckets.map(({ key }) => key);
    console.log(JSON.stringify({
      spring: weekKeys(new Date(2026, 2, 9, 12)),
      autumn: weekKeys(new Date(2026, 10, 2, 12)),
    }));
  `;
  const output = execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {
      encoding: 'utf8',
      env: { ...process.env, TZ: 'America/New_York' },
    }
  );

  assert.deepEqual(JSON.parse(output), {
    spring: [
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ],
    autumn: [
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ],
  });
});

test('invalid or non-Date inputs are rejected', () => {
  for (const value of [null, '2026-08-09', 0, new Date(Number.NaN)]) {
    assert.throws(
      () => buildStatsRanges(/** @type {any} */ (value)),
      new TypeError('now must be a valid Date')
    );
  }
});
