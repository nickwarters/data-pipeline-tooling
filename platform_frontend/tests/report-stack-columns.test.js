// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, walk } from './_dom-stub.js';
import { textContent } from './helpers/semantic-dom.js';

installDom();

const { StackColumns } =
  await import('../src/components/charts/stack-columns.js');

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

const PARTS = [
  { key: 'a', label: 'Alpha', role: 's1' },
  { key: 'b', label: 'Beta', role: 'quiet' },
  { key: 'c', label: 'Gamma', role: 'danger' },
];

/**
 * @param {string} key
 * @param {Record<string, number>} counts
 * @param {any} [extra]
 */
function column(key, counts, extra = {}) {
  return { key, label: key, counts, ...extra };
}

/**
 * @param {any[]} columns
 * @param {any} [config]
 * @param {any[]} [parts]
 * @returns {any}
 */
function chart(columns, config = {}, parts = PARTS) {
  return StackColumns(
    { parts, columns },
    { width: 480, ariaLabel: 'Mix by month', ...config }
  );
}

/** @param {any} root @returns {any[]} */
function groups(root) {
  return byClass(root, 'cora-stack-columns__column');
}

/** @param {any} group @returns {any[]} */
function segmentsOf(group) {
  return byClass(group, 'cora-stack-columns__segment');
}

/** @param {any} root @returns {string[]} */
function hitDescriptions(root) {
  return byClass(root, 'cora-stack-columns__hit').map((hit) =>
    hit.getAttribute('data-cora-chart-description')
  );
}

/** @param {any} group @returns {string[]} */
function labelsOf(group) {
  return group.querySelectorAll('text').map(textContent);
}

/** @param {any} root @returns {string[]} */
function columnLabels(root) {
  return groups(root).flatMap(labelsOf);
}

/** @param {any} segment @returns {number} */
function bottomOf(segment) {
  return Number(/^M[\d.]+,([\d.]+)/.exec(segment.getAttribute('d'))?.[1]);
}

test('stack columns are a detached, named group sized as asked', () => {
  const root = chart([column('m', { a: 1 })], { width: 360, height: 180 });

  assert.equal(root.namespaceURI, SVG_NAMESPACE);
  assert.equal(root.parentNode, null);
  assert.equal(root.getAttribute('role'), 'group');
  assert.equal(root.getAttribute('aria-label'), 'Mix by month');
  assert.equal(root.getAttribute('width'), '360');
  assert.equal(root.getAttribute('height'), '180');
  assert.equal(root.getAttribute('viewBox'), '0 0 360 180');
  assert.ok(
    String(root.getAttribute('class')).split(/\s+/).includes('cora-chart')
  );
});

test('a chart with no height given has a default one', () => {
  const root = chart([column('m', { a: 1 })]);

  assert.ok(num(root, 'height') > 100);
});

test('the axis runs from 0% to 100% in quarters', () => {
  const root = chart([column('m', { a: 1 })]);

  assert.deepEqual(
    byClass(root, 'cora-chart__grid')[0]
      .querySelectorAll('text')
      .map(textContent),
    ['0%', '25%', '50%', '75%', '100%']
  );
});

test('each input draws one column group, in the order given', () => {
  const root = chart([
    column('jan', { a: 1 }),
    column('feb', { a: 1 }),
    column('mar', { a: 1 }),
  ]);

  assert.equal(groups(root).length, 3);
  assert.deepEqual(columnLabels(root), ['jan', 'feb', 'mar']);
  const xs = byClass(root, 'cora-stack-columns__hit').map((hit) =>
    num(hit, 'x')
  );
  assert.deepEqual(
    xs,
    [...xs].sort((a, b) => a - b)
  );
});

test('only parts with something in them draw a segment', () => {
  const root = chart([column('m', { a: 2, b: 0, c: 2 })]);

  const segments = segmentsOf(groups(root)[0]);
  assert.deepEqual(
    segments.map((segment) => segment.getAttribute('fill')),
    ['var(--cora-viz-series-1)', 'var(--cora-color-danger)']
  );
});

test('segments are stacked from the baseline up in the order of the parts', () => {
  const root = chart([column('m', { a: 2, b: 1, c: 1 })]);

  const segments = segmentsOf(groups(root)[0]);
  assert.equal(segments.length, 3);
  const bottoms = segments.map(bottomOf);
  const baseline = num(root, 'height') - 26;
  assert.equal(bottoms[0], baseline);
  assert.ok(bottoms[0] > bottoms[1] && bottoms[1] > bottoms[2]);
  assert.deepEqual(
    segments.map((segment) => segment.getAttribute('fill')),
    [
      'var(--cora-viz-series-1)',
      'var(--cora-viz-quiet)',
      'var(--cora-color-danger)',
    ]
  );
});

test('a column that is all one part fills the plot from baseline to top', () => {
  const root = chart([column('m', { b: 5 })], { height: 200 });

  const [segment] = segmentsOf(groups(root)[0]);
  assert.equal(bottomOf(segment), 174);
  const top = Number(/Q[\d.]+,([\d.]+) /.exec(segment.getAttribute('d'))?.[1]);
  assert.equal(top, 8);
});

test('segment heights follow shares, not counts', () => {
  const root = chart([
    column('quiet', { a: 1, b: 1 }),
    column('busy', { a: 1000, b: 1000 }),
  ]);

  const [quiet, busy] = groups(root).map((group) =>
    segmentsOf(group).map(bottomOf)
  );
  assert.deepEqual(quiet, busy);
});

test('only the top of a column is rounded', () => {
  const root = chart([column('m', { a: 1, b: 1, c: 1 })]);

  const curves = segmentsOf(groups(root)[0]).map(
    (segment) => String(segment.getAttribute('d')).match(/Q/g)?.length ?? 0
  );
  assert.deepEqual(curves, [0, 0, 2]);
});

test('each column has one focusable hit mark covering its band', () => {
  const root = chart([column('a1', { a: 1 }), column('a2', { a: 1 })]);

  const hits = byClass(root, 'cora-stack-columns__hit');
  assert.equal(hits.length, 2);
  for (const hit of hits) {
    assert.equal(hit.getAttribute('data-cora-chart-mark'), 'true');
    assert.equal(hit.getAttribute('tabindex'), '0');
    assert.equal(hit.getAttribute('role'), 'img');
    assert.equal(
      hit.getAttribute('aria-label'),
      hit.getAttribute('data-cora-chart-description')
    );
    assert.equal(hit.getAttribute('fill'), 'transparent');
  }
  assert.equal(num(hits[1], 'x') - num(hits[0], 'x'), num(hits[0], 'width'));
});

test('the hit mark lists every part with its share and count', () => {
  const root = chart([column('May', { a: 3, b: 1, c: 0 })]);

  assert.deepEqual(hitDescriptions(root), [
    'May: Alpha 75% (3), Beta 25% (1), Gamma 0% (0)',
  ]);
});

test('the hit mark is named by the longer description when one is given', () => {
  const root = chart([
    column('May', { a: 1 }, { describe: 'May 2026' }),
    column('Jun', { a: 1 }),
  ]);

  const [first, second] = hitDescriptions(root);
  assert.match(String(first), /^May 2026: /);
  assert.match(String(second), /^Jun: /);
});

test('counts in the description are grouped by thousands and shares are rounded', () => {
  const root = chart([column('m', { a: 1000, b: 2000 })]);

  assert.deepEqual(hitDescriptions(root), [
    'm: Alpha 33% (1,000), Beta 67% (2,000), Gamma 0% (0)',
  ]);
});

test('an all-zero column draws no segments but can still be described', () => {
  const root = chart([column('empty', { a: 0, b: 0, c: 0 })]);

  assert.equal(segmentsOf(groups(root)[0]).length, 0);
  assert.deepEqual(hitDescriptions(root), [
    'empty: Alpha 0% (0), Beta 0% (0), Gamma 0% (0)',
  ]);
  const [hit] = byClass(root, 'cora-stack-columns__hit');
  assert.equal(hit.getAttribute('tabindex'), '0');
});

test('a part missing from a column reads as a count of zero', () => {
  const root = chart([column('m', { a: 4 })]);

  assert.equal(segmentsOf(groups(root)[0]).length, 1);
  assert.deepEqual(hitDescriptions(root), [
    'm: Alpha 100% (4), Beta 0% (0), Gamma 0% (0)',
  ]);
});

test('a column with no counts at all reads as empty', () => {
  const root = chart([column('m', {})]);

  assert.equal(segmentsOf(groups(root)[0]).length, 0);
  assert.match(String(hitDescriptions(root)[0]), /Alpha 0% \(0\)/);
});

test('every column is labelled while they fit', () => {
  const columns = Array.from({ length: 6 }, (_, i) =>
    column(`m${i}`, { a: 1 })
  );

  assert.deepEqual(
    columnLabels(chart(columns)),
    columns.map((c) => c.label)
  );
});

test('labels are thinned when columns are crowded, but the last is always labelled', () => {
  const columns = Array.from({ length: 24 }, (_, i) =>
    column(`m${i}`, { a: 1 })
  );

  const labels = columnLabels(chart(columns));
  assert.ok(labels.length < columns.length);
  assert.equal(labels[0], 'm0');
  assert.equal(labels.at(-1), 'm23');
  assert.equal(new Set(labels).size, labels.length);
});

test('a column is described whether or not it is labelled', () => {
  const columns = Array.from({ length: 24 }, (_, i) =>
    column(`m${i}`, { a: 1 })
  );

  assert.equal(hitDescriptions(chart(columns)).length, 24);
});

test('longer labels thin out sooner than short ones', () => {
  const make = (/** @type {string} */ prefix) =>
    Array.from({ length: 10 }, (_, i) => column(`${prefix}${i}`, { a: 1 }));

  assert.equal(columnLabels(chart(make('m'))).length, 10);
  assert.ok(columnLabels(chart(make('September '))).length < 10);
});

test('a chart too narrow to give each column a band is refused', () => {
  const columns = Array.from({ length: 6 }, (_, i) =>
    column(`m${i}`, { a: 1 })
  );

  assert.doesNotThrow(() => chart(columns, { width: 120 }));
  assert.throws(
    () => chart(columns, { width: 80 }),
    (error) =>
      error instanceof RangeError &&
      /too narrow to draw at 80px/.test(error.message)
  );
});

test('a chart with no parts is refused', () => {
  assert.throws(
    () => chart([column('m', {})], {}, []),
    (error) =>
      error instanceof TypeError && /at least one part/.test(error.message)
  );
  assert.throws(
    () =>
      StackColumns(/** @type {any} */ (undefined), {
        width: 400,
        ariaLabel: 'x',
      }),
    /at least one part/
  );
});

test('a chart with no columns is refused', () => {
  assert.throws(
    () => chart([]),
    (error) =>
      error instanceof TypeError && /at least one column/.test(error.message)
  );
  assert.throws(
    () =>
      StackColumns(/** @type {any} */ ({ parts: PARTS, columns: 'nope' }), {
        width: 400,
        ariaLabel: 'x',
      }),
    TypeError
  );
});

test('a count that is not a finite number is refused', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '3']) {
    assert.throws(
      () => chart([column('m', { a: /** @type {any} */ (bad) })]),
      (error) =>
        error instanceof TypeError &&
        /StackColumns counts must be finite numbers/.test(error.message),
      String(bad)
    );
  }
});

test('a negative count is refused rather than drawn as a share below nothing', () => {
  assert.throws(
    () => chart([column('jan', { a: 3, b: -1, c: 2 })]),
    (error) => error instanceof RangeError && /negative/.test(error.message)
  );
});
