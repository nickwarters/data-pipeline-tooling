// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, walk } from './_dom-stub.js';
import { textContent } from './helpers/semantic-dom.js';

installDom();

const { StackBar } = await import('../src/components/charts/stack-bar.js');

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

/**
 * @param {any[]} parts
 * @param {any} [config]
 * @returns {any}
 */
function stack(parts, config = {}) {
  return StackBar(
    { parts },
    { width: 400, ariaLabel: 'Open by status', ...config }
  );
}

/** @param {string} key @param {number} value @param {string} [role] */
function part(key, value, role = 's1') {
  return { key, label: `Part ${key}`, value, role };
}

/** @param {any} root @returns {any[]} */
function segments(root) {
  return byClass(root, 'cora-stack-bar__segment');
}

/** @param {any} root @returns {(string | null)[]} */
function descriptions(root) {
  return segments(root).map((segment) =>
    segment.getAttribute('data-cora-chart-description')
  );
}

test('a stack bar is a detached, named group one bar tall', () => {
  const root = stack([part('a', 1), part('b', 3)], { width: 320 });

  assert.equal(root.namespaceURI, SVG_NAMESPACE);
  assert.equal(root.parentNode, null);
  assert.equal(root.getAttribute('role'), 'group');
  assert.equal(root.getAttribute('aria-label'), 'Open by status');
  assert.equal(root.getAttribute('width'), '320');
  const height = Number(root.getAttribute('height'));
  assert.equal(root.getAttribute('viewBox'), `0 0 320 ${height}`);
  assert.ok(height > 0 && height < 60);
});

test('each part with something in it draws one segment in its own colour', () => {
  const root = stack([
    part('a', 5, 's1'),
    part('b', 3, 's2'),
    part('c', 2, 's3'),
  ]);

  assert.equal(segments(root).length, 3);
  assert.deepEqual(
    segments(root).map((segment) => segment.getAttribute('fill')),
    [
      'var(--cora-viz-series-1)',
      'var(--cora-viz-series-2)',
      'var(--cora-viz-series-3)',
    ]
  );
});

test('each segment is a focusable mark that says its count and share of the whole', () => {
  const root = stack([part('a', 3), part('b', 1)]);

  assert.deepEqual(descriptions(root), [
    'Part a: 3, 75% of the total',
    'Part b: 1, 25% of the total',
  ]);
  for (const segment of segments(root)) {
    assert.equal(segment.getAttribute('data-cora-chart-mark'), 'true');
    assert.equal(segment.getAttribute('tabindex'), '0');
    assert.equal(segment.getAttribute('role'), 'img');
    assert.equal(
      segment.getAttribute('aria-label'),
      segment.getAttribute('data-cora-chart-description')
    );
  }
});

test('shares are written against what the whole is called', () => {
  const root = stack([part('a', 1), part('b', 1)], { wholeLabel: 'of open' });

  assert.deepEqual(descriptions(root), [
    'Part a: 1, 50% of open',
    'Part b: 1, 50% of open',
  ]);
});

test('counts in the description are grouped by thousands and shares are rounded', () => {
  const root = stack([part('a', 1000), part('b', 2000)]);

  assert.deepEqual(descriptions(root), [
    'Part a: 1,000, 33% of the total',
    'Part b: 2,000, 67% of the total',
  ]);
});

test('a part with nothing in it draws no segment', () => {
  const root = stack([part('a', 4), part('b', 0), part('c', 6)]);

  assert.equal(segments(root).length, 2);
  for (const description of descriptions(root)) {
    assert.doesNotMatch(String(description), /Part b/);
  }
});

test('the segments fill the width of the bar, less the gaps between them', () => {
  const root = stack([part('a', 5), part('b', 0), part('c', 3), part('d', 2)], {
    width: 400,
  });

  const lastPath = String(segments(root).pop().getAttribute('d'));
  const end = Number(/Q([\d.]+),0 /.exec(lastPath)?.[1]);
  assert.ok(Math.abs(end - 400) < 1e-6);
});

test('only the outer ends of the bar are rounded', () => {
  const root = stack([part('a', 1), part('b', 1), part('c', 1)]);

  const curves = segments(root).map(
    (segment) => String(segment.getAttribute('d')).match(/Q/g)?.length ?? 0
  );
  assert.deepEqual(curves, [2, 0, 2]);
});

test('a lone segment is rounded at both ends', () => {
  const root = stack([part('a', 0), part('b', 7)]);

  assert.equal(
    String(segments(root)[0].getAttribute('d')).match(/Q/g)?.length,
    4
  );
});

test('a count is written inside a segment wide enough to hold it', () => {
  const root = stack([part('a', 900), part('b', 1)]);

  const counts = byClass(root, 'cora-stack-bar__count');
  assert.deepEqual(counts.map(textContent), ['900']);
  assert.equal(counts[0].getAttribute('aria-hidden'), 'true');
});

test('a segment too narrow to hold its count leaves it to the description', () => {
  const root = stack([part('a', 900), part('b', 1)]);

  assert.equal(segments(root).length, 2);
  assert.match(String(descriptions(root)[1]), /^Part b: 1,/);
  assert.equal(byClass(root, 'cora-stack-bar__count').length, 1);
});

test('a narrower bar writes fewer counts inline', () => {
  const parts = [part('a', 50), part('b', 30), part('c', 20)];

  assert.equal(
    byClass(stack(parts, { width: 400 }), 'cora-stack-bar__count').length,
    3
  );
  assert.ok(
    byClass(stack(parts, { width: 60 }), 'cora-stack-bar__count').length < 3
  );
});

test('inline counts are formatted like the description', () => {
  const root = stack([part('a', 12345)], { width: 400 });

  assert.deepEqual(byClass(root, 'cora-stack-bar__count').map(textContent), [
    '12,345',
  ]);
});

test('an all-zero whole draws a single mark saying there is none', () => {
  const root = stack([part('a', 0), part('b', 0)]);

  assert.equal(segments(root).length, 0);
  const empty = byClass(root, 'cora-stack-bar__empty');
  assert.equal(empty.length, 1);
  assert.equal(
    empty[0].getAttribute('data-cora-chart-description'),
    'None of the total'
  );
  assert.equal(empty[0].getAttribute('tabindex'), '0');
  assert.equal(empty[0].getAttribute('aria-label'), 'None of the total');
  assert.equal(empty[0].getAttribute('width'), '400');
});

test('the none mark is worded against what the whole is called', () => {
  const root = stack([part('a', 0)], { wholeLabel: 'open' });

  assert.equal(
    byClass(root, 'cora-stack-bar__empty')[0].getAttribute(
      'data-cora-chart-description'
    ),
    'None open'
  );
});

test('a whole with something in it draws no none mark', () => {
  const root = stack([part('a', 0), part('b', 2)]);

  assert.equal(byClass(root, 'cora-stack-bar__empty').length, 0);
});

test('a bar shows up to six parts', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((key) => part(key, 1));

  assert.equal(segments(stack(six)).length, 6);
});

test('more than six parts is refused', () => {
  const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((key) => part(key, 1));

  assert.throws(
    () => stack(seven),
    (error) =>
      error instanceof RangeError && /at most 6 parts/.test(error.message)
  );
});

test('a stack bar with no parts is refused', () => {
  assert.throws(
    () => StackBar({ parts: [] }, { width: 400, ariaLabel: 'x' }),
    TypeError
  );
  assert.throws(
    () =>
      StackBar(/** @type {any} */ (undefined), { width: 400, ariaLabel: 'x' }),
    /at least one part/
  );
  assert.throws(
    () =>
      StackBar(/** @type {any} */ ({ parts: 'nope' }), {
        width: 400,
        ariaLabel: 'x',
      }),
    TypeError
  );
});

test('a negative part is refused', () => {
  assert.throws(
    () => stack([part('a', 3), part('b', -1)]),
    (error) =>
      error instanceof RangeError && /must not be negative/.test(error.message)
  );
});

test('a part that is not a finite number is refused', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '3', undefined]) {
    assert.throws(
      () => stack([part('a', /** @type {any} */ (bad))]),
      (error) =>
        error instanceof TypeError &&
        /StackBar values must be finite numbers/.test(error.message),
      String(bad)
    );
  }
});
