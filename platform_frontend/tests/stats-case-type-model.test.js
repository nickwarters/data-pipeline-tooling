// @ts-check

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStatsRanges } from '../src/evaluators/stats-range-model.js';
import { buildStatsCaseTypeBreakdown } from '../src/evaluators/stats-case-type-model.js';

const NOW = new Date(2026, 7, 10, 12);
const [week, month, threeMonths] = buildStatsRanges(NOW);

/** @param {string} date @param {string} caseType @param {number} count */
function row(date, caseType, count) {
  return { date, case_type: caseType, count };
}

test('Case Type breakdown includes both range boundaries and excludes today', () => {
  const breakdown = buildStatsCaseTypeBreakdown(
    [
      row(week.start, 'complaints', 2),
      row(week.end, 'complaints', 3),
      row(week.today, 'complaints', 100),
      row('2026-08-02', 'complaints', 100),
      row('2026-08-11', 'complaints', 100),
    ],
    week
  );

  assert.equal(breakdown.total, 5);
  assert.deepEqual(breakdown.rows, [
    { key: 'complaints', label: 'Complaints', count: 5, share: 1 },
  ]);
});

test('Case Type breakdown uses date-only boundaries for daily and monthly descriptors', () => {
  const daily = buildStatsCaseTypeBreakdown(
    [row('2026-07-01', 'complaints', 2), row('2026-08-09', 'complaints', 3)],
    month
  );
  const monthly = buildStatsCaseTypeBreakdown(
    [row('2026-05-01', 'complaints', 4), row('2026-08-09', 'complaints', 5)],
    threeMonths
  );

  assert.equal(month.grain, 'day');
  assert.equal(threeMonths.grain, 'month');
  assert.equal(daily.total, 5);
  assert.equal(monthly.total, 9);
});

test('Case Type breakdown aggregates duplicate sparse rows and suppresses zero totals', () => {
  const breakdown = buildStatsCaseTypeBreakdown(
    [
      row('2026-08-04', 'complaints', 2),
      row('2026-08-05', 'complaints', 3),
      row('2026-08-04', 'example-case-type', 0),
      row('2026-08-05', 'zero-type', 0),
      row('2026-08-06', 'negative-type', -1),
      row('2026-08-07', 'negative-type', 1),
    ],
    week
  );

  assert.equal(breakdown.total, 5);
  assert.deepEqual(
    breakdown.rows.map(({ key, count }) => ({ key, count })),
    [{ key: 'complaints', count: 5 }]
  );
});

test('Case Type breakdown returns an empty shape when no positive rows match', () => {
  assert.deepEqual(
    buildStatsCaseTypeBreakdown([row('2026-08-10', 'complaints', 4)], week),
    { rows: [], total: 0 }
  );
  assert.deepEqual(buildStatsCaseTypeBreakdown([], week), {
    rows: [],
    total: 0,
  });
});

test('Case Type breakdown calculates one-type and equal two-type shares', () => {
  const one = buildStatsCaseTypeBreakdown(
    [row('2026-08-04', 'complaints', 7)],
    week
  );
  const two = buildStatsCaseTypeBreakdown(
    [
      row('2026-08-04', 'complaints', 4),
      row('2026-08-05', 'example-case-type', 4),
    ],
    week
  );

  assert.equal(one.rows[0]?.share, 1);
  assert.equal(one.total, 7);
  assert.deepEqual(
    two.rows.map(({ share }) => share),
    [0.5, 0.5]
  );
  assert.equal(two.total, 8);
});

test('Case Type breakdown order depends on display label and slug, not feed order', () => {
  const first = buildStatsCaseTypeBreakdown(
    [
      row('2026-08-04', 'example-case-type', 1),
      row('2026-08-05', 'complaints', 1),
    ],
    week
  );
  const second = buildStatsCaseTypeBreakdown(
    [
      row('2026-08-05', 'complaints', 1),
      row('2026-08-04', 'example-case-type', 1),
    ],
    week
  );

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.rows.map(({ key }) => key),
    ['complaints', 'example-case-type']
  );
});

test('Case Type breakdown uses manifest display names and humanizes unknown slugs', () => {
  const unknown = 'example-case-type';
  const breakdown = buildStatsCaseTypeBreakdown(
    [row('2026-08-04', 'complaints', 1), row('2026-08-05', unknown, 1)],
    week
  );

  assert.equal(
    breakdown.rows.find(({ key }) => key === 'complaints')?.label,
    'Complaints'
  );
  const fallback = breakdown.rows.find(({ key }) => key === unknown);
  assert.equal(fallback?.label, 'Example Case Type');
  assert.notEqual(fallback?.label, unknown);
});
