// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evenIndexes,
  formatCount,
  formatPercent,
  linearScale,
  markAttributes,
  niceAxis,
  paint,
  requireFiniteValues,
  textWidth,
} from '../src/components/charts/chart-kit.js';

const ROLES = /** @type {const} */ ([
  's1',
  's2',
  's3',
  's4',
  's5',
  's6',
  'quiet',
  'quiet-strong',
  'range',
  'danger',
  'warning',
]);

test('every colour role paints with a design token, never a literal colour', () => {
  for (const role of ROLES) {
    assert.match(paint(role), /^var\(--cora-[a-z0-9-]+\)$/, role);
  }
});

test('each series role paints a different colour', () => {
  const series = ['s1', 's2', 's3', 's4', 's5', 's6'].map((role) =>
    paint(/** @type {any} */ (role))
  );
  assert.equal(new Set(series).size, series.length);
});

test('a status role never borrows a series colour', () => {
  const series = new Set(
    ['s1', 's2', 's3', 's4', 's5', 's6'].map((role) =>
      paint(/** @type {any} */ (role))
    )
  );
  assert.equal(series.has(paint('danger')), false);
  assert.equal(series.has(paint('warning')), false);
});

test('an unknown colour role throws instead of drawing in a default colour', () => {
  assert.throws(
    () => paint(/** @type {any} */ ('magenta')),
    /unknown chart colour role: magenta/
  );
  assert.throws(() => paint(/** @type {any} */ (undefined)), TypeError);
});

test('a linear scale maps the ends of the domain onto the ends of the range', () => {
  const scale = linearScale(0, 10, 100, 200);

  assert.equal(scale(0), 100);
  assert.equal(scale(10), 200);
  assert.equal(scale(5), 150);
});

test('a linear scale can run against the grain for a downward-growing axis', () => {
  const scale = linearScale(0, 10, 100, 0);

  assert.equal(scale(0), 100);
  assert.equal(scale(10), 0);
  assert.equal(scale(2.5), 75);
});

test('a zero-width domain maps every value to the start of the range', () => {
  const scale = linearScale(5, 5, 40, 90);

  assert.equal(scale(5), 40);
  assert.equal(scale(500), 40);
  assert.equal(Number.isFinite(scale(-3)), true);
});

test('an axis ends on a round number that holds the maximum, in whole steps', () => {
  for (const max of [1, 2, 3, 4, 7, 9, 13, 24, 99, 101, 250, 1000, 12345]) {
    const axis = niceAxis(max);

    assert.ok(Number.isInteger(axis.step), `step for ${max}`);
    assert.ok(axis.step >= 1, `step for ${max}`);
    assert.ok(axis.max >= max, `max for ${max}`);
    assert.equal(axis.max % axis.step, 0, `max is a whole number of steps`);
  }
});

test('an axis over a fraction of a Case still steps in whole Cases', () => {
  assert.deepEqual(niceAxis(0.5), { max: 1, step: 1 });
  assert.deepEqual(niceAxis(3), { max: 3, step: 1 });
});

test('an axis over a large maximum steps in round amounts', () => {
  const axis = niceAxis(1000);

  assert.equal(axis.step, 250);
  assert.equal(axis.max, 1000);
});

test('an axis aims for the requested number of steps above zero', () => {
  assert.equal(niceAxis(40, 4).max / niceAxis(40, 4).step <= 5, true);
  assert.equal(niceAxis(40, 8).step < niceAxis(40, 4).step, true);
});

test('an empty or non-positive maximum still gives a readable axis', () => {
  assert.deepEqual(niceAxis(0), { max: 4, step: 1 });
  assert.deepEqual(niceAxis(-7), { max: 4, step: 1 });
  assert.deepEqual(niceAxis(Number.NaN), { max: 4, step: 1 });
  assert.deepEqual(niceAxis(0, 6), { max: 6, step: 1 });
});

test('label positions always include both ends of the series', () => {
  for (const [count, want] of [
    [10, 3],
    [31, 5],
    [365, 7],
    [100, 2],
  ]) {
    const indexes = evenIndexes(count, want);

    assert.equal(indexes[0], 0, `first of ${count}`);
    assert.equal(indexes[indexes.length - 1], count - 1, `last of ${count}`);
    assert.ok(indexes.length <= want, `no more than ${want} of ${count}`);
    assert.deepEqual(
      indexes,
      [...new Set(indexes)].sort((a, b) => a - b),
      'ascending and unique'
    );
  }
});

test('label positions are spread evenly across the series', () => {
  assert.deepEqual(evenIndexes(9, 3), [0, 4, 8]);
  assert.deepEqual(evenIndexes(11, 6), [0, 2, 4, 6, 8, 10]);
});

test('a series shorter than the label budget is labelled at every position', () => {
  assert.deepEqual(evenIndexes(3, 5), [0, 1, 2]);
  assert.deepEqual(evenIndexes(4, 4), [0, 1, 2, 3]);
});

test('asking for fewer than two labels still labels both ends', () => {
  assert.deepEqual(evenIndexes(10, 1), [0, 9]);
  assert.deepEqual(evenIndexes(10, 0), [0, 9]);
});

test('a series with no positions has no label positions', () => {
  assert.deepEqual(evenIndexes(0, 5), []);
  assert.deepEqual(evenIndexes(-2, 5), []);
});

test('a longer label is estimated wider, and a larger font wider again', () => {
  assert.ok(textWidth('abcdef') > textWidth('abc'));
  assert.ok(textWidth('abc', 16) > textWidth('abc', 12));
  assert.equal(textWidth(''), 0);
});

test('counts are grouped by thousands', () => {
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(999), '999');
  assert.equal(formatCount(1234), '1,234');
  assert.equal(formatCount(1234567), '1,234,567');
});

test('counts are rounded to whole numbers', () => {
  assert.equal(formatCount(2.4), '2');
  assert.equal(formatCount(2.6), '3');
  assert.equal(formatCount(1234.5), '1,235');
});

test('a share is written as a whole-number percentage by default', () => {
  assert.equal(formatPercent(0), '0%');
  assert.equal(formatPercent(0.256), '26%');
  assert.equal(formatPercent(1), '100%');
});

test('a share can be written to more decimal places', () => {
  assert.equal(formatPercent(0.256, 1), '25.6%');
  assert.equal(formatPercent(1 / 3, 2), '33.33%');
});

test('a focusable mark carries its description and announces itself', () => {
  const attributes = markAttributes('Overdue: 4 Cases');

  assert.equal(attributes['data-cora-chart-mark'], 'true');
  assert.equal(attributes['data-cora-chart-description'], 'Overdue: 4 Cases');
  assert.equal(attributes.tabindex, '0');
  assert.equal(attributes.role, 'img');
  assert.equal(attributes['aria-label'], 'Overdue: 4 Cases');
});

test('a mark is focusable unless it says otherwise', () => {
  assert.deepEqual(markAttributes('x'), markAttributes('x', {}));
  assert.deepEqual(
    markAttributes('x'),
    markAttributes('x', { focusable: true })
  );
});

test('a mark that is not focusable stays out of the tab order and the accessibility tree', () => {
  const attributes = markAttributes('Aug 8: Settled 3', { focusable: false });

  assert.equal(attributes['data-cora-chart-mark'], 'true');
  assert.equal(attributes['data-cora-chart-description'], 'Aug 8: Settled 3');
  assert.equal('tabindex' in attributes, false);
  assert.equal('role' in attributes, false);
  assert.equal('aria-label' in attributes, false);
});

test('finite numbers are accepted, including zero and negatives', () => {
  assert.doesNotThrow(() => requireFiniteValues([0, -3, 2.5, 1e9], 'Values'));
  assert.doesNotThrow(() => requireFiniteValues([], 'Values'));
});

test('anything that is not a finite number is rejected, naming what it was checking', () => {
  for (const bad of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    '3',
    null,
    undefined,
    {},
  ]) {
    assert.throws(
      () => requireFiniteValues([1, bad], 'Thing values'),
      (error) =>
        error instanceof TypeError &&
        /Thing values must be finite numbers/.test(error.message),
      String(bad)
    );
  }
});
