// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, walk } from './_dom-stub.js';

installDom();

const { Sparkline } = await import('../src/components/charts/sparkline.js');

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** @param {any} root @param {string} className @returns {any} */
function only(root, className) {
  /** @type {any[]} */
  const found = [];
  walk(root, (node) => {
    if (node.getAttribute('class')?.split(/\s+/).includes(className)) {
      found.push(node);
    }
  });
  assert.equal(found.length, 1, className);
  return found[0];
}

/** @param {any} node @param {string} attribute */
function num(node, attribute) {
  return Number(node.getAttribute(attribute));
}

test('a sparkline is a detached SVG sized to the tile it sits in', () => {
  const chart = Sparkline([1, 3, 2]);

  assert.equal(chart.namespaceURI, SVG_NAMESPACE);
  assert.equal(chart.parentNode, null);
  assert.equal(chart.getAttribute('width'), '72');
  assert.equal(chart.getAttribute('height'), '26');
  assert.equal(chart.getAttribute('viewBox'), '0 0 72 26');
});

test('a sparkline can be drawn at another size', () => {
  const chart = Sparkline([1, 3, 2], { width: 120, height: 40 });

  assert.equal(chart.getAttribute('viewBox'), '0 0 120 40');
  assert.ok(num(only(chart, 'cora-sparkline__latest'), 'cx') <= 120);
});

test('a sparkline is hidden from assistive technology and out of the tab order', () => {
  const chart = Sparkline([4, 5, 6]);

  assert.equal(chart.getAttribute('aria-hidden'), 'true');
  assert.equal(chart.getAttribute('focusable'), 'false');
  assert.equal(chart.getAttribute('tabindex'), null);
  assert.equal(chart.getAttribute('aria-label'), null);
});

test('a sparkline draws one line through every value, starting with a move', () => {
  const path = only(Sparkline([1, 4, 2, 8]), 'cora-sparkline__line');
  const d = path.getAttribute('d');

  assert.match(d, /^M/);
  assert.equal(d.match(/M/g).length, 1);
  assert.equal(d.match(/L/g).length, 3);
  assert.equal(path.getAttribute('fill'), 'none');
});

test('a sparkline line is quiet and only the latest point wears the series colour', () => {
  const chart = Sparkline([1, 2, 3]);

  assert.match(
    only(chart, 'cora-sparkline__line').getAttribute('stroke'),
    /^var\(--cora-viz-quiet/
  );
  assert.equal(
    only(chart, 'cora-sparkline__latest').getAttribute('fill'),
    'var(--cora-viz-series-1)'
  );
});

test('the latest point sits at the end of a rising line, at the top of the drawing', () => {
  const chart = Sparkline([1, 5, 9], { width: 72, height: 26 });
  const dot = only(chart, 'cora-sparkline__latest');

  assert.equal(num(dot, 'cx'), 67);
  assert.equal(num(dot, 'cy'), 4);
});

test('the latest point sits at the bottom of a falling line', () => {
  const dot = only(
    Sparkline([9, 5, 1], { width: 72, height: 26 }),
    'cora-sparkline__latest'
  );

  assert.equal(num(dot, 'cy'), 22);
});

test('a higher value is drawn higher on the page', () => {
  const d = only(Sparkline([2, 10]), 'cora-sparkline__line').getAttribute('d');
  const [first, second] = [...d.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map((m) =>
    Number(m[2])
  );

  assert.ok(second < first);
});

test('a flat series sits in the middle of the drawing rather than on the floor', () => {
  const chart = Sparkline([7, 7, 7, 7], { width: 72, height: 26 });

  assert.equal(num(only(chart, 'cora-sparkline__latest'), 'cy'), 13);
  const ys = [
    ...only(chart, 'cora-sparkline__line')
      .getAttribute('d')
      .matchAll(/,([\d.]+)/g),
  ].map((m) => Number(m[1]));
  assert.deepEqual(ys, [13, 13, 13, 13]);
});

test('a series of zeros is flat, not an error', () => {
  const chart = Sparkline([0, 0]);

  assert.equal(num(only(chart, 'cora-sparkline__latest'), 'cy'), 13);
});

test('a sparkline needs at least two values to show a trend', () => {
  assert.throws(() => Sparkline([3]), RangeError);
  assert.throws(() => Sparkline([]), /at least two values/);
});

test('a sparkline refuses values that are not finite numbers', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '4', null]) {
    assert.throws(
      () => Sparkline(/** @type {any} */ ([1, bad])),
      /Sparkline values must be finite numbers/,
      String(bad)
    );
  }
});
