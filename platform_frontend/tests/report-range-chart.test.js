// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, walk } from './_dom-stub.js';
import { textContent } from './helpers/semantic-dom.js';

installDom();

const { RangeChart } = await import('../src/components/charts/range-chart.js');

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
 * @param {number} p50
 * @param {number} p90
 * @param {number} [count]
 */
function row(key, p50, p90, count = 40) {
  return { key, label: `Stage ${key}`, p50, p90, count };
}

/**
 * @param {any[]} rows
 * @param {any} [config]
 * @returns {any}
 */
function chart(rows, config = {}) {
  return RangeChart(
    { rows },
    { width: 480, ariaLabel: 'How long stages take', ...config }
  );
}

/** @param {any} root @returns {any[]} */
function medians(root) {
  return byClass(root, 'cora-range-chart__median');
}

/** @param {any} root @returns {any[]} */
function bands(root) {
  return byClass(root, 'cora-range-chart__band');
}

/** @param {any} root @returns {string[]} */
function tickLabels(root) {
  return byClass(root, 'cora-chart__grid')[0]
    .querySelectorAll('text')
    .map(textContent);
}

test('a range chart is a detached, named group sized as asked', () => {
  const root = chart([row('a', 2, 5)], { width: 360 });

  assert.equal(root.namespaceURI, SVG_NAMESPACE);
  assert.equal(root.parentNode, null);
  assert.equal(root.getAttribute('role'), 'group');
  assert.equal(root.getAttribute('aria-label'), 'How long stages take');
  assert.equal(root.getAttribute('width'), '360');
  assert.ok(
    String(root.getAttribute('class')).split(/\s+/).includes('cora-chart')
  );
  const height = num(root, 'height');
  assert.equal(root.getAttribute('viewBox'), `0 0 360 ${height}`);
  assert.ok(height > 0);
});

test('each input draws one row with its label, band and median dot', () => {
  const root = chart([row('a', 2, 5), row('b', 3, 9), row('c', 1, 2)]);

  assert.equal(byClass(root, 'cora-range-chart__row').length, 3);
  assert.equal(bands(root).length, 3);
  assert.equal(medians(root).length, 3);
  assert.deepEqual(
    byClass(root, 'cora-chart__category-label').map(textContent),
    ['Stage a', 'Stage b', 'Stage c']
  );
});

test('rows are stacked down the chart in the order given', () => {
  const root = chart([row('a', 2, 5), row('b', 3, 9), row('c', 1, 2)]);

  const ys = medians(root).map((dot) => num(dot, 'cy'));
  assert.deepEqual(
    ys,
    [...ys].sort((a, b) => a - b)
  );
  assert.equal(new Set(ys).size, 3);
  assert.ok(num(root, 'height') > ys[2]);
});

test('the median dot is a focusable mark naming median, 90th percentile and Case count', () => {
  const root = chart([row('review', 5.14, 12, 1200)]);

  const [dot] = medians(root);
  const description =
    'Stage review: median 5.1 d, 90th percentile 12.0 d, over 1,200 Cases';
  assert.equal(dot.getAttribute('data-cora-chart-mark'), 'true');
  assert.equal(dot.getAttribute('data-cora-chart-description'), description);
  assert.equal(dot.getAttribute('aria-label'), description);
  assert.equal(dot.getAttribute('tabindex'), '0');
  assert.equal(dot.getAttribute('role'), 'img');
});

test('the band is not a mark of its own, so a row is one stop', () => {
  const root = chart([row('a', 2, 5)]);

  assert.equal(bands(root)[0].getAttribute('data-cora-chart-mark'), null);
  assert.equal(bands(root)[0].getAttribute('tabindex'), null);
});

test('the band runs from the median to the 90th percentile', () => {
  const root = chart([row('a', 2, 5), row('b', 4, 9)]);

  for (const [i, dot] of medians(root).entries()) {
    const band = bands(root)[i];
    assert.equal(num(band, 'x'), num(dot, 'cx'));
    assert.ok(num(band, 'width') > 2);
  }
  assert.ok(num(medians(root)[1], 'cx') > num(medians(root)[0], 'cx'));
  const [a, b] = bands(root);
  assert.ok(num(b, 'x') + num(b, 'width') > num(a, 'x') + num(a, 'width'));
});

test('a median equal to its 90th percentile still draws a visible band', () => {
  const root = chart([row('a', 3, 3), row('b', 3, 9)]);

  assert.equal(num(bands(root)[0], 'width'), 2);
});

test('dot and band are painted from the median and range roles', () => {
  const root = chart([row('a', 2, 5)]);

  assert.equal(
    medians(root)[0].getAttribute('fill'),
    'var(--cora-viz-series-1)'
  );
  assert.equal(bands(root)[0].getAttribute('fill'), 'var(--cora-viz-range)');
});

test('the axis starts at zero and ticks in round steps past the longest 90th percentile', () => {
  const root = chart([row('a', 2, 5), row('b', 4, 12)]);

  assert.deepEqual(tickLabels(root), ['0', '5d', '10d', '15d']);
  const lines = byClass(root, 'cora-chart__grid')[0].querySelectorAll('line');
  assert.equal(lines.length, 4);
  assert.equal(lines[0].getAttribute('class'), 'cora-chart__axis-line');
  assert.ok(
    lines
      .slice(1)
      .every(
        (/** @type {any} */ tick) =>
          tick.getAttribute('class') === 'cora-chart__grid-line'
      )
  );
});

test('axis labels are written with the tick format given, except zero', () => {
  const root = chart([row('a', 2, 12)], {
    formatTick: (/** @type {number} */ value) => `${value} days`,
  });

  assert.deepEqual(tickLabels(root), ['0', '5 days', '10 days', '15 days']);
});

test('values are written with the format given', () => {
  const root = chart([row('a', 2, 5, 3)], {
    format: (/** @type {number} */ value) => `${value} hours`,
  });

  assert.equal(
    medians(root)[0].getAttribute('data-cora-chart-description'),
    'Stage a: median 2 hours, 90th percentile 5 hours, over 3 Cases'
  );
});

test('a longer label leaves less room, and a chart too narrow for it is refused', () => {
  const rows = [row('a', 2, 5)];
  assert.doesNotThrow(() => chart(rows, { width: 200 }));
  assert.throws(
    () => chart(rows, { width: 100 }),
    (error) =>
      error instanceof RangeError &&
      /too narrow to draw at 100px/.test(error.message)
  );
  assert.throws(
    () =>
      chart([{ ...row('a', 2, 5), label: 'A very long stage name' }], {
        width: 200,
      }),
    RangeError
  );
});

test('a range chart with no rows is refused', () => {
  assert.throws(
    () => chart([]),
    (error) =>
      error instanceof TypeError && /at least one row/.test(error.message)
  );
  assert.throws(
    () =>
      RangeChart(/** @type {any} */ (undefined), {
        width: 400,
        ariaLabel: 'x',
      }),
    /at least one row/
  );
  assert.throws(
    () =>
      RangeChart(/** @type {any} */ ({ rows: 'nope' }), {
        width: 400,
        ariaLabel: 'x',
      }),
    TypeError
  );
});

test('a median, percentile or count that is not a finite number is refused', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '3', null]) {
    const value = /** @type {any} */ (bad);
    for (const rows of [
      [row('a', value, 5)],
      [row('a', 2, value)],
      [row('a', 2, 5, value)],
    ]) {
      assert.throws(
        () => chart(rows),
        (error) =>
          error instanceof TypeError &&
          /RangeChart values must be finite numbers/.test(error.message),
        String(bad)
      );
    }
  }
});

test('a negative median is refused', () => {
  assert.throws(
    () => chart([row('a', -1, 5)]),
    (error) =>
      error instanceof RangeError &&
      /0 <= median <= 90th percentile/.test(error.message)
  );
});

test('a 90th percentile below the median is refused, naming the row', () => {
  assert.throws(
    () => chart([row('a', 2, 5), row('slow', 6, 5)]),
    (error) => error instanceof RangeError && /"slow"/.test(error.message)
  );
});
