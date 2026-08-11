// @ts-check

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installDom } from './_dom-stub.js';
import { buildStatsRanges } from '../src/evaluators/stats-range-model.js';
import { buildStatsReport } from '../src/evaluators/stats-report-model.js';

installDom();

const { statsBreakdownTableView } =
  await import('../src/pages/my-stats/stats-breakdown-table-view.js');

const [week, , threeMonths] = buildStatsRanges(new Date(2026, 7, 10, 12));

test('breakdown table follows daily report buckets and exposes accessible headers', () => {
  const report = buildStatsReport({
    range: week,
    completeThrough: '2026-08-08',
    feedRows: [
      { date: '2026-08-08', case_type: 'complaints', count: 2 },
      { date: '2026-08-08', case_type: 'example-case-type', count: 1 },
    ],
    liveTypedCounts: {
      '2026-08-10': { complaints: 1 },
    },
  });

  const table = statsBreakdownTableView(report).querySelector('table');
  assert.ok(table);
  assert.equal(
    table.querySelector('caption')?.textContent,
    'Week Case Type breakdown'
  );
  const head = table.querySelector('thead');
  const body = table.querySelector('tbody');
  const bodyRows = Array.from(body?.childNodes ?? []);
  assert.deepEqual(
    bodyRows.map((row) => row.querySelector('th')?.textContent),
    week.buckets.map((bucket) => bucket.label)
  );
  assert.deepEqual(
    Array.from(head?.querySelectorAll('th') ?? [], (cell) => cell.textContent),
    [
      'Period',
      'Total',
      'Complaints count',
      'Complaints percentage',
      'Example Case Type count',
      'Example Case Type percentage',
    ]
  );
  const lastCells = bodyRows[7]?.querySelectorAll('td');
  assert.deepEqual(
    Array.from(lastCells ?? [], (cell) => cell.textContent),
    ['1', '1', '100%', '0', '0%']
  );
});

test('breakdown table follows monthly report buckets and reconciles totals', () => {
  const report = buildStatsReport({
    range: threeMonths,
    completeThrough: '2026-08-08',
    feedRows: [
      { date: '2026-07-10', case_type: 'complaints', count: 3 },
      { date: '2026-08-04', case_type: 'complaints', count: 2 },
    ],
    liveTypedCounts: { '2026-08-09': { 'example-case-type': 1 } },
  });
  const table = statsBreakdownTableView(report).querySelector('table');
  const body = table?.querySelector('tbody');
  const bodyRows = Array.from(body?.childNodes ?? []);

  assert.deepEqual(
    bodyRows.map((row) => row.querySelector('th')?.textContent),
    threeMonths.buckets.map((bucket) => bucket.label)
  );
  for (const [index, row] of bodyRows.entries()) {
    const cells = row.querySelectorAll('td');
    assert.equal(cells[0]?.textContent, String(report.buckets[index].total));
  }
  assert.equal(report.buckets.at(-1)?.label, 'August (current month)');
});
