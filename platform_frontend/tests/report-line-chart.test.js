// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, walk } from './_dom-stub.js';
import { textContent } from './helpers/semantic-dom.js';

installDom();

const { LineChart } = await import('../src/components/charts/line-chart.js');

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** @param {any} root @param {string} className @returns {any[]} */
function byClass(root, className) {
  /** @type {any[]} */
  const found = [];
  walk(root, (node) => {
    if (node.getAttribute('class')?.split(/\s+/).includes(className)) {
      found.push(node);
    }
  });
  return found;
}

/** @param {any} node @param {string} attribute */
function num(node, attribute) {
  return Number(node.getAttribute(attribute));
}

/**
 * @param {string} key
 * @param {number[]} ys
 * @param {string} [role]
 * @returns {any}
 */
function line(key, ys, role = 's1') {
  return {
    key,
    label: key.toUpperCase(),
    role,
    points: ys.map((y, i) => ({ x: `x${i}`, y })),
  };
}

/**
 * @param {any[]} series
 * @param {Partial<import("../src/components/charts/line-chart.js").LineChartConfig>} [config]
 * @returns {any}
 */
function chart(series, config = {}) {
  return LineChart(
    { series },
    { width: 480, ariaLabel: 'Cases over time', ...config }
  );
}

/** @param {any} root @returns {string[]} */
function tickLabels(root) {
  return byClass(root, 'cora-chart__grid')[0]
    .querySelectorAll('text')
    .map(textContent);
}

/** @param {any} root @returns {string[]} */
function hoverDescriptions(root) {
  return byClass(root, 'cora-line-chart__hit').map((hit) =>
    hit.getAttribute('data-cora-chart-description')
  );
}

test('a line chart is a detached, named SVG sized as asked', () => {
  const root = chart([line('a', [1, 2, 3])], { width: 480, height: 220 });

  assert.equal(root.namespaceURI, SVG_NAMESPACE);
  assert.equal(root.parentNode, null);
  assert.equal(root.getAttribute('role'), 'img');
  assert.equal(root.getAttribute('aria-label'), 'Cases over time');
  assert.equal(root.getAttribute('width'), '480');
  assert.equal(root.getAttribute('viewBox'), '0 0 480 220');
});

test('a line chart has a default height when none is given', () => {
  const root = chart([line('a', [1, 2, 3])]);

  assert.equal(root.getAttribute('height'), '200');
  assert.equal(root.getAttribute('viewBox'), '0 0 480 200');
});

test('each series draws exactly one line in its own colour', () => {
  const root = chart([
    line('a', [1, 2, 3], 's1'),
    line('b', [3, 2, 1], 's2'),
    line('c', [2, 2, 2], 's3'),
  ]);

  const paths = byClass(root, 'cora-line-chart__line');
  assert.equal(paths.length, 3);
  assert.deepEqual(
    paths.map((path) => path.getAttribute('stroke')),
    [
      'var(--cora-viz-series-1)',
      'var(--cora-viz-series-2)',
      'var(--cora-viz-series-3)',
    ]
  );
  for (const path of paths) {
    assert.equal(path.getAttribute('fill'), 'none');
    assert.equal(path.getAttribute('d').match(/L/g).length, 2);
  }
});

test('a lone series is not washed with an area unless asked', () => {
  const root = chart([line('a', [1, 2, 3])]);

  assert.equal(byClass(root, 'cora-line-chart__area').length, 0);
});

test('a lone series asked for an area gets one wash in its colour, closed along the baseline', () => {
  const root = chart([line('a', [1, 4, 3], 's2')], { area: true });

  const areas = byClass(root, 'cora-line-chart__area');
  assert.equal(areas.length, 1);
  assert.equal(areas[0].getAttribute('fill'), 'var(--cora-viz-series-2)');
  assert.match(areas[0].getAttribute('d'), /Z$/);
});

test('several series are never washed with an area, even when asked', () => {
  const root = chart([line('a', [1, 2, 3]), line('b', [3, 2, 1], 's2')], {
    area: true,
  });

  assert.equal(byClass(root, 'cora-line-chart__area').length, 0);
});

test('by default each line is marked only at its latest point', () => {
  const root = chart([line('a', [1, 2, 3, 4]), line('b', [4, 3, 2, 1], 's2')]);

  assert.equal(byClass(root, 'cora-line-chart__dot').length, 2);
});

test('with dots on, every point of every series is marked', () => {
  const root = chart([line('a', [1, 2, 3, 4]), line('b', [4, 3, 2, 1], 's2')], {
    dots: true,
  });

  assert.equal(byClass(root, 'cora-line-chart__dot').length, 8);
});

test('the latest point is marked larger than the others', () => {
  const root = chart([line('a', [1, 2, 3])], { dots: true });
  const radii = byClass(root, 'cora-line-chart__dot').map((dot) =>
    num(dot, 'r')
  );

  assert.equal(radii[2] > radii[0], true);
  assert.equal(radii[0], radii[1]);
});

test('a lone line writes its latest value at its end and does not name itself', () => {
  const root = chart([line('open', [1, 2, 1234])]);

  const labels = byClass(root, 'cora-chart__value-label');
  assert.equal(labels.length, 1);
  assert.equal(textContent(labels[0]), '1,234');
});

test('with several lines, each end label carries the latest value and the series name', () => {
  const root = chart([line('a', [1, 2, 30]), line('b', [40, 20, 3], 's2')]);

  const labels = byClass(root, 'cora-chart__value-label').map(textContent);
  assert.equal(labels.length, 2);
  assert.ok(labels.some((text) => text.includes('30') && text.includes('A')));
  assert.ok(labels.some((text) => text.includes('3') && text.includes('B')));
});

test('end labels use the value formatter', () => {
  const root = chart([line('a', [1, 2, 3])], { formatY: (y) => `${y} Cases` });

  assert.equal(
    textContent(byClass(root, 'cora-chart__value-label')[0]),
    '3 Cases'
  );
});

test('end labels that sit well apart stay put with no leader line', () => {
  const root = chart([line('a', [1, 2, 50]), line('b', [60, 30, 2], 's2')]);

  assert.equal(byClass(root, 'cora-chart__leader').length, 0);
});

test('end labels that would collide are pushed apart and joined back to their lines', () => {
  const root = chart([
    line('a', [10, 10, 10]),
    line('b', [10, 10, 11], 's2'),
    line('c', [10, 10, 12], 's3'),
  ]);

  const labelYs = byClass(root, 'cora-chart__value-label')
    .map((label) => num(label, 'y'))
    .sort((a, b) => a - b);
  for (let i = 1; i < labelYs.length; i++) {
    assert.ok(labelYs[i] - labelYs[i - 1] >= 14, 'labels do not overlap');
  }
  assert.ok(byClass(root, 'cora-chart__leader').length >= 1);
  for (const leader of byClass(root, 'cora-chart__leader')) {
    assert.notEqual(leader.getAttribute('y1'), leader.getAttribute('y2'));
  }
});

test('no target line is drawn unless one is given', () => {
  const root = chart([line('a', [1, 2, 3])]);

  assert.equal(byClass(root, 'cora-chart__target').length, 0);
});

test('a target draws a line across the plot with its label', () => {
  const root = chart([line('a', [1, 2, 3])], {
    target: { value: 2, label: 'Target 2' },
  });

  const [targetLine] = byClass(root, 'cora-chart__target-line');
  const [targetLabel] = byClass(root, 'cora-chart__target-label');
  assert.equal(targetLine.getAttribute('y1'), targetLine.getAttribute('y2'));
  assert.ok(num(targetLine, 'x2') > num(targetLine, 'x1'));
  assert.equal(textContent(targetLabel), 'Target 2');
});

test('the target label sits above the line when the data runs below it', () => {
  const root = chart([line('a', [2, 2, 2, 2, 2])], {
    yDomain: [0, 20],
    target: { value: 10, label: 'Target' },
  });

  const lineY = num(byClass(root, 'cora-chart__target-line')[0], 'y1');
  const labelY = num(byClass(root, 'cora-chart__target-label')[0], 'y');
  assert.ok(labelY < lineY);
});

test('the target label sits below the line when the data runs above it', () => {
  const root = chart([line('a', [18, 18, 18, 18, 18])], {
    yDomain: [0, 20],
    target: { value: 10, label: 'Target' },
  });

  const lineY = num(byClass(root, 'cora-chart__target-line')[0], 'y1');
  const labelY = num(byClass(root, 'cora-chart__target-label')[0], 'y');
  assert.ok(labelY > lineY);
});

test('the target label is placed over the point furthest from the target, away from the ends', () => {
  const ys = [10, 10, 10, 10, 10, 2, 10, 10, 10, 10];
  const root = chart([line('a', ys)], {
    yDomain: [0, 20],
    target: { value: 10, label: 'Target' },
  });

  const labelX = num(byClass(root, 'cora-chart__target-label')[0], 'x');
  const crosshairX = num(byClass(root, 'cora-line-chart__crosshair')[5], 'x1');
  assert.equal(labelX, crosshairX);
});

test('a target label is not placed over the first point of a long series', () => {
  const ys = [0, 10, 10, 10, 10, 10, 10, 10, 10, 10];
  const root = chart([line('a', ys)], {
    yDomain: [0, 20],
    target: { value: 10, label: 'Target' },
  });

  const labelX = num(byClass(root, 'cora-chart__target-label')[0], 'x');
  const crosshairs = byClass(root, 'cora-line-chart__crosshair').map((c) =>
    num(c, 'x1')
  );
  assert.ok(labelX > crosshairs[0]);
});

test('the y axis starts at zero and ends on a round number above the data', () => {
  const labels = tickLabels(chart([line('a', [3, 9, 13])]));

  assert.equal(labels[0], '0');
  assert.ok(Number(labels[labels.length - 1]) >= 13);
});

test('a fixed y domain changes the axis, and the first tick label says so', () => {
  const labels = tickLabels(
    chart([line('a', [60, 70, 80])], { yDomain: [50, 100] })
  );

  assert.equal(labels[0], '50');
  assert.equal(labels[labels.length - 1], '100');
  assert.equal(labels.length, 5);
});

test('tick labels use the value formatter', () => {
  const labels = tickLabels(
    chart([line('a', [1, 2, 3])], { formatY: (y) => `${y}pts` })
  );

  for (const label of labels) assert.match(label, /pts$/);
});

test('the axis line is the first tick and the others are grid lines', () => {
  const root = chart([line('a', [1, 2, 3])]);

  assert.equal(byClass(root, 'cora-chart__axis-line').length, 1);
  assert.ok(byClass(root, 'cora-chart__grid-line').length >= 3);
});

test('the x axis labels the first and last positions, anchored inward', () => {
  const root = chart([line('a', [1, 2, 3, 4, 5])]);

  const labels = byClass(root, 'cora-chart__x-axis')[0].querySelectorAll(
    'text'
  );
  assert.equal(textContent(labels[0]), 'x0');
  assert.equal(labels[0].getAttribute('text-anchor'), 'start');
  assert.equal(textContent(labels[labels.length - 1]), 'x4');
  assert.equal(labels[labels.length - 1].getAttribute('text-anchor'), 'end');
});

test('a long series is labelled at fewer positions than it has points, ends included', () => {
  const ys = Array.from({ length: 60 }, (_, i) => i);
  const root = chart([line('a', ys)]);

  const labels = byClass(root, 'cora-chart__x-axis')[0]
    .querySelectorAll('text')
    .map(textContent);
  assert.ok(labels.length < 60);
  assert.ok(labels.length >= 2);
  assert.equal(labels[0], 'x0');
  assert.equal(labels[labels.length - 1], 'x59');
  const middle = byClass(root, 'cora-chart__x-axis')[0]
    .querySelectorAll('text')
    .slice(1, -1);
  for (const label of middle) {
    assert.equal(label.getAttribute('text-anchor'), 'middle');
  }
});

test('x axis labels use the x formatter', () => {
  const root = chart([line('a', [1, 2, 3])], {
    formatX: (x) => `Day ${x.slice(1)}`,
  });

  const labels = byClass(root, 'cora-chart__x-axis')[0]
    .querySelectorAll('text')
    .map(textContent);
  assert.deepEqual(labels, ['Day 0', 'Day 1', 'Day 2']);
});

test('there is one hover column per x position', () => {
  const root = chart([line('a', [1, 2, 3, 4]), line('b', [4, 3, 2, 1], 's2')]);

  assert.equal(byClass(root, 'cora-line-chart__column').length, 4);
  assert.equal(byClass(root, 'cora-line-chart__hit').length, 4);
  assert.equal(byClass(root, 'cora-line-chart__crosshair').length, 4);
});

test('every hover column shows a dot for each series', () => {
  const root = chart([line('a', [1, 2, 3]), line('b', [4, 3, 2], 's2')]);

  for (const column of byClass(root, 'cora-line-chart__column')) {
    assert.equal(column.querySelectorAll('circle').length, 2);
  }
});

test('every hover column describes the position and every series value at it', () => {
  const root = chart([line('a', [1, 2, 3]), line('b', [4, 30, 2000], 's2')]);

  assert.deepEqual(hoverDescriptions(root), [
    'x0: A 1, B 4',
    'x1: A 2, B 30',
    'x2: A 3, B 2,000',
  ]);
});

test('hover descriptions name positions with the describer, falling back to the x formatter', () => {
  const series = [line('a', [1, 2])];

  assert.deepEqual(
    hoverDescriptions(chart(series, { formatX: (x) => `short ${x}` })),
    ['short x0: A 1', 'short x1: A 2']
  );
  assert.deepEqual(
    hoverDescriptions(
      chart(series, {
        formatX: (x) => `short ${x}`,
        describeX: (x) => `Long ${x}`,
      })
    ),
    ['Long x0: A 1', 'Long x1: A 2']
  );
});

test('hover descriptions use the value formatter', () => {
  const root = chart([line('a', [1, 2])], { formatY: (y) => `${y} Cases` });

  assert.deepEqual(hoverDescriptions(root), ['x0: A 1 Cases', 'x1: A 2 Cases']);
});

test('hover columns are hoverable but out of the tab order and hidden from assistive technology', () => {
  const root = chart([
    line(
      'a',
      Array.from({ length: 30 }, (_, i) => i)
    ),
  ]);

  const [columns] = byClass(root, 'cora-line-chart__columns');
  assert.equal(columns.getAttribute('aria-hidden'), 'true');
  for (const hit of byClass(root, 'cora-line-chart__hit')) {
    assert.equal(hit.getAttribute('data-cora-chart-mark'), 'true');
    assert.equal(hit.getAttribute('tabindex'), null);
    assert.equal(hit.getAttribute('aria-label'), null);
    assert.equal(hit.getAttribute('role'), null);
  }
});

test('the hover columns tile the plot without spilling past its ends', () => {
  const root = chart([line('a', [1, 2, 3, 4, 5])]);

  const axis = byClass(root, 'cora-chart__axis-line')[0];
  const plotLeft = num(axis, 'x1');
  const plotRight = num(axis, 'x2');
  for (const hit of byClass(root, 'cora-line-chart__hit')) {
    assert.ok(num(hit, 'x') >= plotLeft - 1e-9);
    assert.ok(num(hit, 'x') + num(hit, 'width') <= plotRight + 1e-9);
    assert.ok(num(hit, 'width') > 0);
  }
});

test('a chart of zeros still draws an axis and a line', () => {
  const root = chart([line('a', [0, 0, 0])]);

  assert.equal(byClass(root, 'cora-line-chart__line').length, 1);
  assert.ok(tickLabels(root).length >= 2);
});

test('a line chart with no data is refused', () => {
  assert.throws(
    () => LineChart({ series: [] }, { width: 480, ariaLabel: 'x' }),
    TypeError
  );
  assert.throws(
    () =>
      LineChart(/** @type {any} */ (undefined), { width: 480, ariaLabel: 'x' }),
    /at least one series/
  );
  assert.throws(
    () =>
      LineChart(/** @type {any} */ ({ series: 'nope' }), {
        width: 480,
        ariaLabel: 'x',
      }),
    TypeError
  );
});

test('a line chart needs at least two points to draw a line', () => {
  assert.throws(() => chart([line('a', [5])]), RangeError);
  assert.throws(() => chart([line('a', [])]), /at least two points/);
});

test('every series must share the same x positions', () => {
  assert.throws(
    () => chart([line('a', [1, 2, 3]), line('b', [1, 2])]),
    /same x positions/
  );
});

test('a point that is not a finite number is refused, naming its series', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '3']) {
    assert.throws(
      () =>
        chart([line('a', [1, 2]), line('late', [1, /** @type {any} */ (bad)])]),
      (error) =>
        error instanceof TypeError &&
        /LineChart series "late" must be finite numbers/.test(error.message),
      String(bad)
    );
  }
});

test('a line chart too narrow to draw is refused rather than drawn squashed', () => {
  assert.throws(
    () => chart([line('a', [1, 2, 3])], { width: 60 }),
    (error) =>
      error instanceof RangeError && /too narrow.*60px/.test(error.message)
  );
});

test('a wider end label needs a wider chart', () => {
  const series = [line('a', [1, 2, 3]), line('a-much-longer-name', [3, 2, 1])];

  assert.throws(() => chart(series, { width: 150 }), RangeError);
  assert.doesNotThrow(() => chart(series, { width: 480 }));
});

for (const yDomain of /** @type {[number, number][]} */ ([
  [5, 5],
  [1, 0],
])) {
  test(`an axis that does not run upwards (${yDomain.join(' to ')}) is refused rather than drawn`, () => {
    assert.throws(
      () => chart([line('a', [1, 2, 3])], { yDomain }),
      (error) => error instanceof RangeError && /yDomain/.test(error.message)
    );
  });
}

test('a value below zero is refused on an axis that starts at zero, and drawn on one that includes it', () => {
  assert.throws(
    () => chart([line('a', [1, -2, 3])]),
    (error) => error instanceof RangeError && /below zero/.test(error.message)
  );
  assert.ok(chart([line('a', [1, -2, 3])], { yDomain: [-4, 4] }));
});
