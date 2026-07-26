// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

const { dataTableView, nextTableSort, reduceTableSort, sortRequested } =
  await import('../src/views/data-table.js');

const rows = [
  { id: '2', person: { name: 'Bob' }, score: 7 },
  { id: '1', person: { name: 'Alice' }, score: 12 },
];

const columns = [
  {
    key: 'name',
    label: 'Name',
    value: 'person.name',
    sortable: true,
    href: (/** @type {any} */ row) => `#/people/${row.id}`,
  },
  {
    key: 'score',
    label: 'Score',
    value: (/** @type {any} */ row) => row.score,
    sortable: true,
    format: (/** @type {any} */ value) => `${value} points`,
  },
];

test('data table view: descriptors resolve paths, derivations, formatting, and links', () => {
  const view = dataTableView({
    rows,
    columns,
    sort: null,
    onSort: () => {},
    emptyMessage: 'No people.',
    rowKey: (row) => row.id,
  });

  const bodyRows = view.querySelector('tbody')?.querySelectorAll('tr') ?? [];
  assert.equal(bodyRows.length, 2);
  assert.equal(bodyRows[0].textContent, 'Bob7 points');
  assert.equal(
    bodyRows[0].querySelector('a')?.getAttribute('href'),
    '#/people/2'
  );
});

test('data table view: sort state controls row order and header semantics', () => {
  /** @type {string[]} */
  const requested = [];
  const view = dataTableView({
    rows,
    columns,
    sort: { key: 'name', dir: 'asc' },
    onSort: (key) => requested.push(key),
    emptyMessage: 'No people.',
    rowKey: (row) => row.id,
  });

  assert.deepEqual(
    [...(view.querySelector('tbody')?.querySelectorAll('tr') ?? [])].map(
      (row) => row.textContent
    ),
    ['Alice12 points', 'Bob7 points']
  );
  const nameHeader = view.querySelector('th');
  assert.equal(nameHeader?.getAttribute('aria-sort'), 'ascending');
  assert.deepEqual(
    [...(view.querySelector('tbody')?.querySelectorAll('tr') ?? [])].map(
      (row) => row.getAttribute('key')
    ),
    ['1', '2']
  );
  nameHeader
    ?.querySelector('button')
    ?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));
  assert.deepEqual(requested, ['name']);
});

test('data table view: renders its configured empty state without a table', () => {
  const view = dataTableView({
    rows: [],
    columns,
    sort: null,
    onSort: () => {},
    emptyMessage: 'No people.',
    rowKey: (row) => row.id,
  });

  assert.equal(view.tagName, 'P');
  assert.equal(view.textContent, 'No people.');
  assert.equal(view.querySelector('table'), null);
});

test('data table view: row activation navigates through the injected seam', () => {
  /** @type {string[]} */
  const navigated = [];
  const view = dataTableView({
    rows,
    columns,
    sort: null,
    onSort: () => {},
    emptyMessage: 'No people.',
    rowKey: (row) => row.id,
    rowHref: (row) => `#/people/${row.id}`,
    onNavigate: (hash) => navigated.push(hash),
  });

  view
    .querySelector('tbody')
    ?.querySelector('tr')
    ?.dispatchEvent(/** @type {any} */ ({ type: 'keydown', key: 'Enter' }));
  assert.deepEqual(navigated, ['#/people/2']);
});

test('data table view: arrow keys move focus between grid cells', () => {
  const view = dataTableView({
    rows,
    columns,
    sort: null,
    onSort: () => {},
    emptyMessage: 'No people.',
    rowKey: (row) => row.id,
  });
  const tableRows = view.querySelector('tbody')?.querySelectorAll('tr') ?? [];
  const firstRowCells = tableRows[0].querySelectorAll('td');
  const secondRowCells = tableRows[1].querySelectorAll('td');

  firstRowCells[0].focus();
  firstRowCells[0].dispatchEvent(
    /** @type {any} */ ({
      type: 'keydown',
      key: 'ArrowRight',
      bubbles: true,
      preventDefault() {},
    })
  );
  assert.equal(document.activeElement, firstRowCells[1]);

  firstRowCells[1].dispatchEvent(
    /** @type {any} */ ({
      type: 'keydown',
      key: 'ArrowDown',
      bubbles: true,
      preventDefault() {},
    })
  );
  assert.equal(document.activeElement, secondRowCells[1]);

  secondRowCells[1].dispatchEvent(
    /** @type {any} */ ({
      type: 'keydown',
      key: 'ArrowLeft',
      bubbles: true,
      preventDefault() {},
    })
  );
  assert.equal(document.activeElement, secondRowCells[0]);

  secondRowCells[0].dispatchEvent(
    /** @type {any} */ ({
      type: 'keydown',
      key: 'ArrowUp',
      bubbles: true,
      preventDefault() {},
    })
  );
  assert.equal(document.activeElement, firstRowCells[0]);
});

test('data table view: null values stay last in both sort directions', () => {
  const nullableRows = [
    ...rows,
    { id: '3', person: { name: 'Null' }, score: null },
  ];

  for (const [dir, expected] of [
    ['asc', ['2', '1', '3']],
    ['desc', ['1', '2', '3']],
  ]) {
    const view = dataTableView({
      rows: nullableRows,
      columns,
      sort: /** @type {any} */ ({ key: 'score', dir }),
      onSort: () => {},
      emptyMessage: 'No people.',
      rowKey: (row) => row.id,
    });

    assert.deepEqual(
      [...(view.querySelector('tbody')?.querySelectorAll('tr') ?? [])].map(
        (row) => row.getAttribute('key')
      ),
      expected
    );
  }
});

test('data table view: footer rows remain outside the sortable body', () => {
  for (const dir of /** @type {const} */ (['asc', 'desc'])) {
    const view = dataTableView({
      rows,
      footerRows: [{ id: 'total', person: { name: 'Total' }, score: 19 }],
      columns,
      sort: { key: 'score', dir },
      onSort: () => {},
      emptyMessage: 'No people.',
      rowKey: (row) => row.id,
    });

    assert.deepEqual(
      [...(view.querySelector('tbody')?.querySelectorAll('tr') ?? [])].map(
        (row) => row.getAttribute('key')
      ),
      dir === 'asc' ? ['2', '1'] : ['1', '2']
    );
    assert.equal(
      view.querySelector('tfoot')?.querySelector('tr')?.textContent,
      'Total19 points'
    );
  }
});

test('data table view: nextTableSort starts ascending and toggles direction', () => {
  assert.deepEqual(nextTableSort(null, 'name'), { key: 'name', dir: 'asc' });
  assert.deepEqual(nextTableSort({ key: 'score', dir: 'desc' }, 'name'), {
    key: 'name',
    dir: 'asc',
  });
  assert.deepEqual(nextTableSort({ key: 'name', dir: 'asc' }, 'name'), {
    key: 'name',
    dir: 'desc',
  });
  assert.deepEqual(nextTableSort({ key: 'name', dir: 'desc' }, 'name'), {
    key: 'name',
    dir: 'asc',
  });
});

test('data table view: sortRequested names the action after its table', () => {
  assert.deepEqual(sortRequested('journey', 'reference'), {
    type: 'journey-table/sort-requested',
    key: 'reference',
  });
});

test('data table view: reduceTableSort reduces its own table sort action', () => {
  assert.deepEqual(
    reduceTableSort(null, sortRequested('journey', 'reference'), 'journey'),
    { key: 'reference', dir: 'asc' }
  );
  assert.deepEqual(
    reduceTableSort(
      { key: 'reference', dir: 'asc' },
      sortRequested('journey', 'reference'),
      'journey'
    ),
    { key: 'reference', dir: 'desc' }
  );
});

test('data table view: reduceTableSort ignores another table on the same page', () => {
  assert.equal(
    reduceTableSort(null, sortRequested('appeals', 'raised'), 'reviewer'),
    undefined
  );
  assert.equal(
    reduceTableSort(null, { type: 'cases/loaded' }, 'journey'),
    undefined
  );
});

test('data table view: reduceTableSort never returns a falsy sort, so `if (sort)` is safe', () => {
  // `nextTableSort` always builds a fresh object; the only falsy result the
  // helper can produce is the `undefined` "not my action" signal.
  for (const current of [
    null,
    { key: 'a', dir: 'asc' },
    { key: 'a', dir: 'desc' },
  ]) {
    assert.ok(
      reduceTableSort(
        /** @type {any} */ (current),
        sortRequested('t', 'a'),
        't'
      )
    );
  }
});
