// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const { dataTableView, nextTableSort } =
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

test('data table view: row activation follows the configured row link', () => {
  const view = dataTableView({
    rows,
    columns,
    sort: null,
    onSort: () => {},
    emptyMessage: 'No people.',
    rowKey: (row) => row.id,
    rowHref: (row) => `#/people/${row.id}`,
  });

  view
    .querySelector('tbody')
    ?.querySelector('tr')
    ?.dispatchEvent(/** @type {any} */ ({ type: 'keydown', key: 'Enter' }));
  assert.equal(/** @type {any} */ (globalThis).location.hash, '#/people/2');
});

test('data table view: null values stay last when sorting descending', () => {
  const view = dataTableView({
    rows: [...rows, { id: '3', person: { name: 'Null' }, score: null }],
    columns,
    sort: { key: 'score', dir: 'desc' },
    onSort: () => {},
    emptyMessage: 'No people.',
    rowKey: (row) => row.id,
  });

  assert.deepEqual(
    [...(view.querySelector('tbody')?.querySelectorAll('tr') ?? [])].map(
      (row) => row.getAttribute('key')
    ),
    ['1', '2', '3']
  );
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
