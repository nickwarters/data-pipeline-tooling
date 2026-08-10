// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

const { statsChartView } =
  await import('../src/pages/my-stats/stats-chart-view.js');

/** @param {any} node @param {(node: any) => void} visit */
function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes ?? []) walk(child, visit);
}

/** @param {any} root @param {string} className @returns {any[]} */
function byClass(root, className) {
  /** @type {any[]} */
  const found = [];
  walk(root, (node) => {
    if (node.getAttribute?.('class')?.split(/\s+/).includes(className)) {
      found.push(node);
    }
  });
  return found;
}

/** @param {any} root @returns {string[]} */
function markLabels(root) {
  return byClass(root, 'cora-grouped-bar-chart__bar').map((bar) =>
    bar.getAttribute('aria-label')
  );
}

/**
 * @param {Partial<any>} [overrides]
 * @returns {any}
 */
function report(overrides = {}) {
  return {
    range: {
      key: 'week',
      label: 'Week',
      grain: 'day',
      start: '2026-08-08',
      end: '2026-08-09',
      today: '2026-08-10',
      buckets: [],
    },
    buckets: [
      { key: '2026-08-08', label: 'Aug 8', settled: 3, provisional: null },
      { key: '2026-08-09', label: 'Aug 9', settled: null, provisional: 2 },
    ],
    headline: {},
    ...overrides,
  };
}

test('stats chart: a bucket draws only the provenance it has days for', () => {
  const chart = statsChartView(report());

  assert.deepEqual(markLabels(chart), [
    'Aug 8: Settled, 3',
    'Aug 9: Provisional, 2, provisional',
  ]);
});

test('stats chart: published marks are solid and live ones hollow', () => {
  const [settled, provisional] = byClass(
    statsChartView(report()),
    'cora-grouped-bar-chart__bar'
  );

  assert.equal(settled.getAttribute('fill'), 'var(--cora-color-accent)');
  assert.equal(provisional.getAttribute('fill'), 'none');
  assert.equal(provisional.getAttribute('stroke'), 'var(--cora-color-accent)');
});

test('stats chart: a bucket spanning the boundary draws both bars', () => {
  const chart = statsChartView(
    report({
      range: { ...report().range, grain: 'month', label: '3 months' },
      buckets: [
        { key: '2026-08', label: 'August', settled: 6, provisional: 3 },
      ],
    })
  );

  assert.deepEqual(markLabels(chart), [
    'August: Settled, 6',
    'August: Provisional, 3, provisional',
  ]);
});

test('stats chart: the y axis counts in whole Cases', () => {
  const tickLabels = (/** @type {any} */ chart) =>
    byClass(chart, 'cora-grouped-bar-chart__tick-label').map(
      (label) => label.childNodes[0]?.data ?? label.textContent
    );

  assert.deepEqual(tickLabels(statsChartView(report())), [
    '0',
    '1',
    '2',
    '3',
    '4',
  ]);
  assert.deepEqual(
    tickLabels(
      statsChartView(
        report({
          buckets: [{ key: 'a', label: 'A', settled: 13, provisional: null }],
        })
      )
    ),
    ['0', '4', '8', '12', '16']
  );
});

test('stats chart: an empty range still draws a readable axis', () => {
  const chart = statsChartView(report({ buckets: [] }));

  assert.equal(markLabels(chart).length, 0);
  assert.equal(
    chart.getAttribute('aria-label'),
    'Reportable Cases by day, week'
  );
});

test('stats chart: the accessible name names the grain and the range', () => {
  const chart = statsChartView(
    report({
      range: { ...report().range, grain: 'month', label: '12 months' },
    })
  );

  assert.equal(
    chart.getAttribute('aria-label'),
    'Reportable Cases by month, 12 months'
  );
});
