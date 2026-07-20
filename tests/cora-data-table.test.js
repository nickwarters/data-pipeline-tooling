// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  queryAllByRole,
} from './helpers/semantic-dom.js';

installDom();
const { DataTable } = await import('../src/components/base/cora-data-table.js');

const COLUMNS = /** @type {any[]} */ ([
  {
    key: 'name',
    label: 'Name',
    sortable: true,
    getValue: (/** @type {any} */ row) => row.name,
  },
  {
    key: 'score',
    label: 'Score',
    getValue: (/** @type {any} */ row) => row.score,
  },
]);

/** @param {any} [overrides] */
function render(overrides = {}) {
  return DataTable({
    columns: COLUMNS,
    rows: [{ name: 'Ada', score: null }],
    sortKey: 'name',
    sortDir: 'asc',
    rowClass: () => 'flagged',
    onRowActivate: null,
    onHeaderClick() {},
    onKeydown() {},
    onTbody() {},
    ...overrides,
  });
}

test('DataTable renders accessible rows, values, empty fallback, and sort state', () => {
  const table = render();
  assert.equal(table.getAttribute('role'), 'grid');
  assert.equal(
    table.querySelector('th')?.getAttribute('aria-sort'),
    'ascending'
  );
  assert.deepEqual(
    queryAllByRole(table, 'row')
      .slice(1)
      .map((row) => row.textContent),
    ['Ada—']
  );
  assert.equal(
    table.querySelector('tbody')?.querySelector('tr')?.className,
    'flagged'
  );
});

test('DataTable sortable header and delegated grid keydown report interactions', () => {
  /** @type {any[]} */
  const calls = [];
  const table = render({
    sortDir: 'desc',
    onHeaderClick: (/** @type {string} */ key) => calls.push(['sort', key]),
    onKeydown: (/** @type {any} */ event) => calls.push(['key', event.key]),
  });
  assert.equal(
    table.querySelector('th')?.getAttribute('aria-sort'),
    'descending'
  );
  fireEvent(getByRole(table, 'button', { name: 'Name' }), 'click');
  fireEvent(table, 'keydown', { key: 'ArrowDown' });
  assert.deepEqual(calls, [
    ['sort', 'name'],
    ['key', 'ArrowDown'],
  ]);
});

test('DataTable renders custom cells and activates a row only on Enter', () => {
  /** @type {any[]} */
  const activated = [];
  const table = render({
    columns: [
      {
        key: 'custom',
        label: 'Custom',
        renderCell: (/** @type {any} */ row) => row.node,
      },
      { key: 'empty', label: 'Empty', renderCell: () => null },
    ],
    rows: [{ node: document.createElement('strong') }],
    sortKey: '',
    onRowActivate: (/** @type {any} */ row) => activated.push(row),
  });
  /** @type {HTMLElement} */ (table.querySelector('strong')).textContent =
    'Custom';
  const row = queryAllByRole(table, 'row')[1];
  fireEvent(row, 'keydown', { key: 'Space' });
  fireEvent(row, 'keydown', { key: 'Enter' });
  assert.equal(activated.length, 1);
  assert.equal(row.querySelectorAll('td')[1].childElementCount, 0);
});

test('DataTable renders a dash for a column without a cell reader', () => {
  const table = render({
    columns: [{ key: 'unknown', label: 'Unknown' }],
    rows: [{}],
    sortKey: '',
  });
  assert.equal(queryAllByRole(table, 'row')[1].textContent, '—');
});
