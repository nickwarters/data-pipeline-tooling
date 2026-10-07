// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, walk } from './_dom-stub.js';
import { textContent } from './helpers/semantic-dom.js';

installDom();

const { BarList } = await import('../src/components/charts/bar-list.js');

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
 * @param {any[]} rows
 * @param {Partial<import("../src/components/charts/bar-list.js").BarListConfig>} [config]
 * @returns {any}
 */
function list(rows, config = {}) {
  return BarList({ rows }, { width: 480, ariaLabel: 'Open Cases', ...config });
}

/** @param {string} key @param {number} value @param {any} [extra] */
function row(key, value, extra = {}) {
  return { key, label: `Label ${key}`, value, ...extra };
}

/** @param {any} root @returns {any[]} */
function bars(root) {
  return byClass(root, 'cora-bar-list__bar');
}

test('a bar list is a detached, named group sized to its rows', () => {
  const root = list([row('a', 1), row('b', 2), row('c', 3)], { width: 400 });

  assert.equal(root.namespaceURI, SVG_NAMESPACE);
  assert.equal(root.parentNode, null);
  assert.equal(root.getAttribute('role'), 'group');
  assert.equal(root.getAttribute('aria-label'), 'Open Cases');
  assert.equal(root.getAttribute('width'), '400');
  const height = num(root, 'height');
  assert.equal(root.getAttribute('viewBox'), `0 0 400 ${height}`);
  assert.ok(height > 3 * 20);
});

test('a taller list needs a taller drawing', () => {
  assert.ok(
    num(list([row('a', 1), row('b', 2)]), 'height') >
      num(list([row('a', 1)]), 'height')
  );
});

test('there is one row per input, in the order given', () => {
  const root = list([row('c', 1), row('a', 9), row('b', 5)]);

  const rows = byClass(root, 'cora-bar-list__row');
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => r.getAttribute('key')),
    ['c', 'a', 'b']
  );
  assert.deepEqual(
    byClass(root, 'cora-chart__category-label').map(textContent),
    ['Label c', 'Label a', 'Label b']
  );
});

test('rows are stacked downward without overlapping', () => {
  const root = list([row('a', 1), row('b', 2), row('c', 3)]);

  const ys = byClass(root, 'cora-chart__category-label').map((label) =>
    num(label, 'y')
  );
  assert.ok(ys[0] < ys[1] && ys[1] < ys[2]);
});

test('each value is written at the end of its bar', () => {
  const root = list([row('a', 1234), row('b', 5)]);

  const values = byClass(root, 'cora-chart__value-label');
  assert.deepEqual(values.map(textContent), ['1,234', '5']);
  for (const value of values) {
    assert.equal(value.getAttribute('aria-hidden'), 'true');
  }
});

test('values are written with the value formatter', () => {
  const root = list([row('a', 3)], { format: (value) => `${value} days` });

  assert.equal(
    textContent(byClass(root, 'cora-chart__value-label')[0]),
    '3 days'
  );
});

test('a longer value gets a longer bar from the same baseline', () => {
  const root = list([row('a', 10), row('b', 40), row('c', 20)]);

  const baseline = num(byClass(root, 'cora-chart__axis-line')[0], 'x1');
  const ends = byClass(root, 'cora-chart__value-label').map(
    (label) => num(label, 'x') - 6
  );
  assert.ok(ends[1] > ends[2] && ends[2] > ends[0]);
  assert.ok(ends[0] > baseline);
  for (const bar of bars(root)) {
    assert.match(bar.getAttribute('d'), new RegExp(`^M${baseline},`));
  }
});

test('bar lengths are proportional to their values', () => {
  const root = list([row('a', 10), row('b', 40)]);

  const baseline = num(byClass(root, 'cora-chart__axis-line')[0], 'x1');
  const [short, long] = byClass(root, 'cora-chart__value-label').map(
    (label) => num(label, 'x') - 6 - baseline
  );
  assert.ok(Math.abs(long / short - 4) < 1e-9);
});

test('a bar defaults to the first series colour and can wear another role', () => {
  const root = list([row('a', 1), row('b', 2, { role: 'danger' })]);

  const [plain, status] = bars(root);
  assert.equal(plain.getAttribute('fill'), 'var(--cora-viz-series-1)');
  assert.equal(status.getAttribute('fill'), 'var(--cora-color-danger)');
});

test('every bar is a focusable mark whose description names its row and value', () => {
  const root = list([row('a', 1234), row('b', 0), row('c', 7)]);

  assert.equal(bars(root).length, 3);
  for (const bar of bars(root)) {
    assert.equal(bar.getAttribute('data-cora-chart-mark'), 'true');
    assert.equal(bar.getAttribute('tabindex'), '0');
    assert.equal(bar.getAttribute('role'), 'img');
    assert.equal(
      bar.getAttribute('aria-label'),
      bar.getAttribute('data-cora-chart-description')
    );
  }
  assert.deepEqual(
    bars(root).map((bar) => bar.getAttribute('data-cora-chart-description')),
    ['Label a: 1,234', 'Label b: 0', 'Label c: 7']
  );
});

test('the description carries the unit, then each detail line', () => {
  const root = list(
    [
      row('a', 4, { detail: ['2 due today', 'oldest 9 days'] }),
      row('b', 1, { detail: [] }),
      row('c', 2),
    ],
    { unit: 'Cases' }
  );

  assert.deepEqual(
    bars(root).map((bar) => bar.getAttribute('data-cora-chart-description')),
    [
      'Label a: 4 Cases, 2 due today, oldest 9 days',
      'Label b: 1 Cases',
      'Label c: 2 Cases',
    ]
  );
});

test('a description with no unit does not leave a trailing gap', () => {
  const root = list([row('a', 4)]);

  assert.equal(
    bars(root)[0].getAttribute('data-cora-chart-description'),
    'Label a: 4'
  );
});

test('a zero value draws a zero-length bar that can still be hovered and focused', () => {
  const root = list([row('a', 0), row('b', 5)]);

  const [zero] = bars(root);
  const baseline = num(byClass(root, 'cora-chart__axis-line')[0], 'x1');
  assert.ok(zero.getAttribute('d').length > 0);
  assert.equal(zero.getAttribute('tabindex'), '0');
  assert.equal(zero.getAttribute('data-cora-chart-description'), 'Label a: 0');
  assert.equal(
    num(byClass(root, 'cora-chart__value-label')[0], 'x'),
    baseline + 6
  );
});

test('a list of only zeros is drawn, not refused', () => {
  const root = list([row('a', 0), row('b', 0)]);

  assert.equal(bars(root).length, 2);
  assert.deepEqual(byClass(root, 'cora-chart__value-label').map(textContent), [
    '0',
    '0',
  ]);
});

test('a tiny value still draws a bar long enough to see', () => {
  const root = list([row('a', 1), row('b', 100000)]);

  const baseline = num(byClass(root, 'cora-chart__axis-line')[0], 'x1');
  const tiny = num(byClass(root, 'cora-chart__value-label')[0], 'x') - 6;
  assert.ok(tiny - baseline >= 3);
});

test('a status marker is its own tspan in the status colour, apart from the label text', () => {
  const root = list([
    row('a', 3, { marker: '●', role: 'danger' }),
    row('b', 2, { marker: '▲', role: 'warning' }),
  ]);

  const [first, second] = byClass(root, 'cora-chart__category-label');
  const firstSpans = first.querySelectorAll('tspan');
  assert.equal(firstSpans.length, 2);
  assert.equal(textContent(firstSpans[0]), '●');
  assert.equal(firstSpans[0].getAttribute('fill'), 'var(--cora-color-danger)');
  assert.equal(firstSpans[0].getAttribute('aria-hidden'), 'true');
  assert.equal(textContent(firstSpans[1]), 'Label a');
  assert.equal(firstSpans[1].getAttribute('fill'), null);
  const secondSpans = second.querySelectorAll('tspan');
  assert.equal(
    secondSpans[0].getAttribute('fill'),
    'var(--cora-color-warning)'
  );
});

test('a row with a marker is flagged as a status row; one without is not', () => {
  const root = list([row('a', 3, { marker: '●' }), row('b', 2)]);

  const [withMarker, without] = byClass(root, 'cora-chart__category-label');
  assert.match(withMarker.getAttribute('class'), /category-label--status/);
  assert.doesNotMatch(without.getAttribute('class'), /--status/);
});

test('a row without a marker has a single tspan of label text', () => {
  const root = list([row('a', 3)]);

  const spans = byClass(root, 'cora-chart__category-label')[0].querySelectorAll(
    'tspan'
  );
  assert.equal(spans.length, 1);
  assert.equal(textContent(spans[0]), 'Label a');
});

test('a marker is not repeated in the description', () => {
  const root = list([row('a', 3, { marker: '●' })]);

  assert.doesNotMatch(
    bars(root)[0].getAttribute('data-cora-chart-description'),
    /●/
  );
});

test('a label too long for the budget is shortened with an ellipsis on the chart but kept whole in the description', () => {
  const long = 'Quarterly regulatory reporting backlog for the northern region';
  const root = list([{ key: 'a', label: long, value: 3 }], {
    maxLabelWidth: 120,
    width: 600,
  });

  const shown = textContent(byClass(root, 'cora-chart__category-label')[0]);
  assert.ok(shown.endsWith('…'));
  assert.ok(shown.length < long.length);
  assert.ok(long.startsWith(shown.slice(0, -1)));
  assert.equal(
    bars(root)[0].getAttribute('data-cora-chart-description'),
    `${long}: 3`
  );
});

test('a label that fits is shown whole', () => {
  const root = list([row('a', 3)], { maxLabelWidth: 300 });

  assert.equal(
    textContent(byClass(root, 'cora-chart__category-label')[0]),
    'Label a'
  );
});

test('a marker takes room out of its label budget', () => {
  const label = 'Overdue reviews awaiting sign-off';
  const plain = list([{ key: 'a', label, value: 3 }], { maxLabelWidth: 200 });
  const marked = list([{ key: 'a', label, value: 3, marker: '●' }], {
    maxLabelWidth: 200,
  });

  const shownPlain = textContent(
    byClass(plain, 'cora-chart__category-label')[0]
  );
  const shownMarked = byClass(marked, 'cora-chart__category-label')[0]
    .querySelectorAll('tspan')
    .map(textContent)[1];
  assert.ok(shownMarked.length <= shownPlain.length);
});

test('an absurdly small label budget still keeps the first character', () => {
  const root = list([{ key: 'a', label: 'Alpha', value: 3 }], {
    maxLabelWidth: 1,
    width: 300,
  });

  assert.equal(
    textContent(byClass(root, 'cora-chart__category-label')[0]),
    'A…'
  );
});

test('a bar list with no rows is refused', () => {
  assert.throws(
    () => BarList({ rows: [] }, { width: 480, ariaLabel: 'x' }),
    TypeError
  );
  assert.throws(
    () =>
      BarList(/** @type {any} */ (undefined), { width: 480, ariaLabel: 'x' }),
    /at least one row/
  );
  assert.throws(
    () =>
      BarList(/** @type {any} */ ({ rows: null }), {
        width: 480,
        ariaLabel: 'x',
      }),
    TypeError
  );
});

test('a negative value is refused', () => {
  assert.throws(
    () => list([row('a', 3), row('b', -1)]),
    (error) =>
      error instanceof RangeError && /must not be negative/.test(error.message)
  );
});

test('a value that is not a finite number is refused', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '3', null]) {
    assert.throws(
      () => list([row('a', /** @type {any} */ (bad))]),
      (error) =>
        error instanceof TypeError &&
        /BarList values must be finite numbers/.test(error.message),
      String(bad)
    );
  }
});

test('a bar list too narrow to leave room for bars is refused', () => {
  assert.throws(
    () => list([row('a', 3)], { width: 60 }),
    (error) =>
      error instanceof RangeError && /too narrow.*60px/.test(error.message)
  );
});
