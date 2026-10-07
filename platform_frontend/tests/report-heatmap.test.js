// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, walk } from './_dom-stub.js';
import { textContent } from './helpers/semantic-dom.js';

installDom();

const { Heatmap } = await import('../src/components/charts/heatmap.js');

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
 * @param {number[][]} values
 * @param {any} [config]
 * @returns {any}
 */
function heat(values, config = {}) {
  const columns = values[0]?.length ?? 0;
  return Heatmap(
    { values },
    {
      width: 480,
      ariaLabel: 'Messages by weekday and hour',
      rowLabels: values.map((_, r) => `R${r}`),
      columnLabels: Array.from({ length: columns }, (_, c) => `C${c}`),
      describeCell: (/** @type {number} */ r, /** @type {number} */ c) =>
        `R${r} C${c}`,
      ...config,
    }
  );
}

/** @param {any} root @returns {any[]} */
function cells(root) {
  return byClass(root, 'cora-heatmap__cell');
}

/** @param {any} root @returns {string[]} */
function axisLabels(root) {
  return byClass(root, 'cora-chart__x-axis')[0]
    .querySelectorAll('text')
    .map(textContent);
}

/** @param {any} root @returns {any} */
function legend(root) {
  return byClass(root, 'cora-heatmap__legend')[0];
}

test('a heatmap is a detached, named image sized to its grid', () => {
  const root = heat([[1, 2, 3]], { width: 360 });

  assert.equal(root.namespaceURI, SVG_NAMESPACE);
  assert.equal(root.parentNode, null);
  assert.equal(root.getAttribute('role'), 'img');
  assert.equal(root.getAttribute('aria-label'), 'Messages by weekday and hour');
  assert.equal(root.getAttribute('width'), '360');
  const height = num(root, 'height');
  assert.equal(root.getAttribute('viewBox'), `0 0 360 ${height}`);
  assert.ok(
    String(root.getAttribute('class')).split(/\s+/).includes('cora-chart')
  );
});

test('more rows make a taller heatmap', () => {
  const one = num(heat([[1, 2, 3]]), 'height');
  const three = num(
    heat([
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
    ]),
    'height'
  );

  assert.ok(three > one);
});

test('each value is drawn as one cell, rows laid out top to bottom', () => {
  const root = heat([
    [1, 2, 3],
    [4, 5, 6],
  ]);

  assert.equal(byClass(root, 'cora-heatmap__row').length, 2);
  assert.equal(cells(root).length, 6);
  const [first, , , fourth] = cells(root);
  assert.ok(num(fourth, 'y') > num(first, 'y'));
  assert.equal(num(fourth, 'x'), num(first, 'x'));
  assert.ok(num(cells(root)[1], 'x') > num(first, 'x'));
});

test('each row is labelled at its left', () => {
  const root = heat([[1], [2], [3]], { rowLabels: ['Mon', 'Tue', 'Wed'] });

  const labels = byClass(root, 'cora-heatmap__row').map((row) =>
    textContent(row.querySelectorAll('text')[0])
  );
  assert.deepEqual(labels, ['Mon', 'Tue', 'Wed']);
});

test('a zero cell is its own quiet kind and carries no fill of its own', () => {
  const root = heat([[0, 3, 6]]);

  const [zero, some, most] = cells(root);
  assert.ok(
    zero.getAttribute('class').split(/\s+/).includes('cora-heatmap__cell--zero')
  );
  assert.equal(zero.getAttribute('fill'), null);
  assert.equal(zero.getAttribute('fill-opacity'), null);
  for (const cell of [some, most]) {
    assert.ok(
      !cell
        .getAttribute('class')
        .split(/\s+/)
        .includes('cora-heatmap__cell--zero')
    );
    assert.equal(cell.getAttribute('fill'), 'var(--cora-viz-series-1)');
  }
});

test('the biggest value is drawn at full opacity', () => {
  const root = heat([[1, 50, 200]]);

  assert.equal(num(cells(root)[2], 'fill-opacity'), 1);
  assert.ok(num(cells(root)[0], 'fill-opacity') < 1);
});

test('values are drawn in six steps, a bigger value never lighter than a smaller one', () => {
  const root = heat([[1, 2, 3, 4, 5, 6]]);

  const opacities = cells(root).map((cell) => num(cell, 'fill-opacity'));
  assert.equal(new Set(opacities).size, 6);
  assert.deepEqual(
    opacities,
    [...opacities].sort((a, b) => a - b)
  );
});

test('values close to each other share a step', () => {
  const root = heat([[100, 101, 102, 1000]]);

  const [a, b, c] = cells(root).map((cell) =>
    cell.getAttribute('fill-opacity')
  );
  assert.equal(a, b);
  assert.equal(b, c);
});

test('when every value is zero every cell is a zero cell', () => {
  const root = heat([
    [0, 0, 0],
    [0, 0, 0],
  ]);

  assert.equal(cells(root).length, 6);
  for (const cell of cells(root)) {
    assert.ok(
      cell
        .getAttribute('class')
        .split(/\s+/)
        .includes('cora-heatmap__cell--zero')
    );
    assert.equal(cell.getAttribute('fill'), null);
    assert.equal(cell.getAttribute('fill-opacity'), null);
  }
});

test('a cell is a hover mark but not a stop in the tab order', () => {
  const root = heat([[0, 4, 9]]);

  for (const cell of cells(root)) {
    assert.equal(cell.getAttribute('data-cora-chart-mark'), 'true');
    assert.equal(cell.getAttribute('tabindex'), null);
    assert.equal(cell.getAttribute('role'), null);
    assert.equal(cell.getAttribute('aria-label'), null);
  }
});

test('a cell is described by its name and its value, with the unit when there is one', () => {
  const root = heat(
    [
      [0, 1200],
      [3, 4],
    ],
    {
      unit: 'messages',
      describeCell: (/** @type {number} */ r, /** @type {number} */ c) =>
        `Row ${r} col ${c}`,
    }
  );

  assert.deepEqual(
    cells(root).map((cell) => cell.getAttribute('data-cora-chart-description')),
    [
      'Row 0 col 0: 0 messages',
      'Row 0 col 1: 1,200 messages',
      'Row 1 col 0: 3 messages',
      'Row 1 col 1: 4 messages',
    ]
  );
});

test('a cell with no unit is described by its name and value alone', () => {
  const root = heat([[7]]);

  assert.equal(
    cells(root)[0].getAttribute('data-cora-chart-description'),
    'R0 C0: 7'
  );
});

test('the columns labelled by default are the first, middle and last', () => {
  const root = heat([[1, 2, 3, 4, 5]]);

  assert.deepEqual(axisLabels(root), ['C0', 'C2', 'C4']);
});

test('a label sits under the middle of its column', () => {
  const root = heat([[1, 2, 3, 4, 5]], { labelColumns: [0, 4] });

  const texts = byClass(root, 'cora-chart__x-axis')[0].querySelectorAll('text');
  const [first, last] = [cells(root)[0], cells(root)[4]];
  assert.equal(num(texts[0], 'x'), num(first, 'x') + num(first, 'width') / 2);
  assert.equal(num(texts[1], 'x'), num(last, 'x') + num(last, 'width') / 2);
});

test('only the columns chosen are labelled, in the order chosen', () => {
  const root = heat([[1, 2, 3, 4, 5]], { labelColumns: [3, 1] });

  assert.deepEqual(axisLabels(root), ['C3', 'C1']);
});

test('a chosen column that is not in the grid is ignored', () => {
  const root = heat([[1, 2, 3]], { labelColumns: [-1, 0, 2, 3, 99] });

  assert.deepEqual(axisLabels(root), ['C0', 'C2']);
});

test('no columns chosen means no axis labels', () => {
  const root = heat([[1, 2, 3]], { labelColumns: [] });

  assert.deepEqual(axisLabels(root), []);
});

test('a legend says which way is more, in the same six steps as the cells', () => {
  const root = heat([[1, 2, 3, 4, 5, 6]]);

  const key = legend(root);
  assert.equal(key.getAttribute('aria-hidden'), 'true');
  assert.deepEqual(key.querySelectorAll('text').map(textContent), [
    'Fewer',
    'More',
  ]);
  const swatches = key.querySelectorAll('rect');
  assert.equal(swatches.length, 6);
  const opacities = swatches.map((/** @type {any} */ swatch) =>
    num(swatch, 'fill-opacity')
  );
  assert.deepEqual(
    opacities,
    [...opacities].sort((a, b) => a - b)
  );
  assert.equal(opacities.at(-1), 1);
  assert.deepEqual(
    opacities,
    cells(root).map((cell) => num(cell, 'fill-opacity'))
  );
});

test('the legend is drawn even when every value is zero', () => {
  const root = heat([[0, 0]]);

  assert.equal(legend(root).querySelectorAll('rect').length, 6);
});

test('a heatmap with no rows is refused', () => {
  assert.throws(
    () => heat([]),
    (error) =>
      error instanceof TypeError && /at least one row/.test(error.message)
  );
  assert.throws(
    () =>
      Heatmap(/** @type {any} */ (undefined), {
        width: 400,
        ariaLabel: 'x',
        rowLabels: [],
        columnLabels: [],
        describeCell: () => '',
      }),
    /at least one row/
  );
});

test('rows of different lengths are refused', () => {
  assert.throws(
    () =>
      heat(
        [
          [1, 2, 3],
          [1, 2],
        ],
        {
          rowLabels: ['a', 'b'],
          columnLabels: ['x', 'y', 'z'],
        }
      ),
    (error) =>
      error instanceof RangeError &&
      /same, non-zero number of columns/.test(error.message)
  );
});

test('rows with no columns are refused', () => {
  assert.throws(
    () => heat([[]], { rowLabels: ['a'], columnLabels: [] }),
    RangeError
  );
});

test('a negative value is refused', () => {
  assert.throws(
    () => heat([[1, -1]]),
    (error) =>
      error instanceof RangeError && /must not be negative/.test(error.message)
  );
});

test('a value that is not a finite number is refused', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '3', null]) {
    assert.throws(
      () => heat([[1, /** @type {any} */ (bad)]]),
      (error) =>
        error instanceof TypeError &&
        /Heatmap values must be finite numbers/.test(error.message),
      String(bad)
    );
  }
});

test('a label count that does not match the grid is refused', () => {
  assert.throws(
    () =>
      heat(
        [
          [1, 2],
          [3, 4],
        ],
        { rowLabels: ['only one'] }
      ),
    (error) =>
      error instanceof RangeError &&
      /one label per row and per column/.test(error.message)
  );
  assert.throws(
    () =>
      heat(
        [
          [1, 2],
          [3, 4],
        ],
        { columnLabels: ['only one'] }
      ),
    RangeError
  );
});

test('a heatmap too narrow to give each column room is refused', () => {
  assert.doesNotThrow(() => heat([[1, 2, 3]], { width: 120 }));
  assert.throws(
    () => heat([[1, 2, 3]], { width: 50 }),
    (error) =>
      error instanceof RangeError &&
      /too narrow to draw at 50px/.test(error.message)
  );
});

for (const columns of [1, 2]) {
  test(`a grid only ${columns} column${columns === 1 ? '' : 's'} wide labels each column once`, () => {
    const labels = axisLabels(heat([Array.from({ length: columns }, () => 1)]));
    assert.deepEqual(labels, [...new Set(labels)]);
    assert.equal(labels.length, columns);
  });
}
