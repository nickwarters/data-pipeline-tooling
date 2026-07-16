// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  getByTag,
  queryAllByRole,
  queryAllByTag,
  textContent,
} from './helpers/semantic-dom.js';

installDom();

// ===== IMPORTS =====
const { CORADataTable } =
  await import('../src/components/base/cora-data-table.js');

// ===== HELPERS =====

/** @returns {any} */
function makeTable() {
  const t = new CORADataTable();
  t.columns = [
    {
      key: 'name',
      label: 'Name',
      sortable: true,
      getValue: (/** @type {any} */ r) => r.name,
    },
    { key: 'age', label: 'Age', getValue: (/** @type {any} */ r) => r.age },
  ];
  t.rows = [
    { name: 'Alice', age: 30 },
    { name: 'Bob', age: 25 },
    { name: 'Carol', age: 35 },
  ];
  t.connectedCallback();
  return t;
}

/** @param {any} table */
function rows(table) {
  return queryAllByRole(getByTag(table, 'tbody'), 'row');
}

/** @param {any} row */
function cells(row) {
  return queryAllByRole(row, 'cell');
}

/** @param {any} table */
function firstColumnValues(table) {
  return rows(table).map((row) => textContent(cells(row)[0]));
}

// ===== TESTS =====

test('CORADataTable: renders a table with thead and tbody', () => {
  const t = makeTable();
  assert.equal(queryAllByRole(t, 'grid').length, 1);
  assert.equal(queryAllByTag(t, 'thead').length, 1);
  assert.equal(queryAllByTag(t, 'tbody').length, 1);
});

test('CORADataTable: renders one th per column', () => {
  const t = makeTable();
  assert.equal(queryAllByRole(t, 'columnheader').length, 2);
});

test('CORADataTable: renders one tr per row in tbody', () => {
  const t = makeTable();
  assert.equal(rows(t).length, 3);
});

test('CORADataTable: set sort(null) clears sort key', () => {
  const t = makeTable();
  // Set a sort first
  t.sort = { key: 'name', dir: 'asc' };
  // Now clear it
  t.sort = null;
  // Rows should be in original order
  assert.deepEqual(firstColumnValues(t), ['Alice', 'Bob', 'Carol']);
});

test('CORADataTable: set sort with desc direction sorts descending', () => {
  const t = makeTable();
  t.sort = { key: 'name', dir: 'desc' };
  assert.deepEqual(firstColumnValues(t), ['Carol', 'Bob', 'Alice']);
});

test('CORADataTable: set sort without dir defaults to asc', () => {
  const t = makeTable();
  t.sort = { key: 'name' };
  assert.deepEqual(firstColumnValues(t), ['Alice', 'Bob', 'Carol']);
});

test('CORADataTable: clicking header sorts and second click reverses', () => {
  const t = makeTable();
  const header = getByRole(t, 'button', { name: 'Name' });

  fireEvent(header, 'click');
  assert.deepEqual(firstColumnValues(t), ['Alice', 'Bob', 'Carol']);

  fireEvent(header, 'click');
  assert.deepEqual(firstColumnValues(t), ['Carol', 'Bob', 'Alice']);
});

test('CORADataTable: connectedCallback is idempotent (second call is no-op)', () => {
  const t = makeTable();
  const firstGrid = getByRole(t, 'grid');
  t.connectedCallback();
  assert.equal(getByRole(t, 'grid'), firstGrid, 'must not rebuild');
});

test('CORADataTable: renderCell used when provided, else getValue', () => {
  const t = new CORADataTable();
  t.columns = [
    {
      key: 'label',
      label: 'Label',
      renderCell: (/** @type {any} */ r) => `cell:${r.name}`,
    },
    {
      key: 'val',
      label: 'Val',
      getValue: (/** @type {any} */ r) => r.val,
    },
    {
      key: 'empty',
      label: 'Empty',
      getValue: (/** @type {any} */ r) => r.missing,
    },
  ];
  t.rows = [{ name: 'X', val: 42 }];
  t.connectedCallback();
  const renderedCells = cells(rows(t)[0]);
  assert.equal(
    renderedCells[0].textContent,
    'cell:X',
    'renderCell string used'
  );
  assert.equal(renderedCells[1].textContent, '42', 'getValue used');
  assert.equal(
    renderedCells[2].textContent,
    '—',
    'null/undefined getValue shows em-dash'
  );
});

test('CORADataTable: renderCell returning a non-string node appends it', () => {
  const t = new CORADataTable();
  t.columns = [
    {
      key: 'node',
      label: 'Node',
      renderCell: () => {
        const el = document.createElement('span');
        el.textContent = 'child';
        return el;
      },
    },
  ];
  t.rows = [{}];
  t.connectedCallback();
  const cell = cells(rows(t)[0])[0];
  assert.equal(getByTag(cell, 'span').textContent, 'child');
});

test('CORADataTable: renderCell returning null does not append anything', () => {
  const t = new CORADataTable();
  t.columns = [
    {
      key: 'node',
      label: 'Node',
      renderCell: () => null,
    },
  ];
  t.rows = [{}];
  t.connectedCallback();
  assert.equal(
    cells(rows(t)[0])[0].childElementCount,
    0,
    'null renderCell appends nothing'
  );
});

test('CORADataTable: rowClass is applied', () => {
  const t = new CORADataTable();
  t.columns = [
    { key: 'n', label: 'N', getValue: (/** @type {any} */ r) => r.n },
  ];
  t.rowClass = (/** @type {any} */ r) => (r.flag ? 'flagged' : '');
  t.rows = [
    { n: 1, flag: true },
    { n: 2, flag: false },
  ];
  t.connectedCallback();
  assert.equal(rows(t)[0].className, 'flagged');
  assert.equal(rows(t)[1].className, '');
});

test('CORADataTable: onRowActivate fires on Enter keydown', () => {
  const t = new CORADataTable();
  t.columns = [
    { key: 'n', label: 'N', getValue: (/** @type {any} */ r) => r.n },
  ];
  /** @type {any[]} */
  const activated = [];
  t.onRowActivate = (r) => activated.push(r);
  t.rows = [{ n: 1 }, { n: 2 }];
  t.connectedCallback();
  fireEvent(rows(t)[0], 'keydown', { key: 'Enter' });
  assert.equal(activated.length, 1);
  assert.equal(activated[0].n, 1);
});

// --- grid keyboard navigation ---

test('CORADataTable: grid ignores non-arrow keys', () => {
  const t = makeTable();
  // Should not throw or change focus
  /** @type {any} */ (globalThis)._lastFocused = null;
  fireEvent(getByRole(t, 'grid'), 'keydown', { key: 'Tab' });
  assert.equal(/** @type {any} */ (globalThis)._lastFocused, null);
});

test('CORADataTable: ArrowRight moves to next cell in row', () => {
  const t = makeTable();
  const [cell0, cell1] = cells(rows(t)[0]);

  /** @type {any} */ (globalThis)._lastFocused = cell0;
  fireEvent(getByRole(t, 'grid'), 'keydown', { key: 'ArrowRight' });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    cell1,
    'ArrowRight should move to next cell'
  );
});

test('CORADataTable: ArrowLeft moves to previous cell in row', () => {
  const t = makeTable();
  const [cell0, cell1] = cells(rows(t)[0]);

  /** @type {any} */ (globalThis)._lastFocused = cell1;
  fireEvent(getByRole(t, 'grid'), 'keydown', { key: 'ArrowLeft' });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    cell0,
    'ArrowLeft should move to previous cell'
  );
});

test('CORADataTable: ArrowDown moves to cell below', () => {
  const t = makeTable();
  const cell00 = cells(rows(t)[0])[0];
  const cell10 = cells(rows(t)[1])[0];

  /** @type {any} */ (globalThis)._lastFocused = cell00;
  fireEvent(getByRole(t, 'grid'), 'keydown', { key: 'ArrowDown' });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    cell10,
    'ArrowDown should move one row down'
  );
});

test('CORADataTable: ArrowUp moves to cell above', () => {
  const t = makeTable();
  const cell00 = cells(rows(t)[0])[0];
  const cell10 = cells(rows(t)[1])[0];

  /** @type {any} */ (globalThis)._lastFocused = cell10;
  fireEvent(getByRole(t, 'grid'), 'keydown', { key: 'ArrowUp' });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    cell00,
    'ArrowUp should move one row up'
  );
});

test('CORADataTable: ArrowRight at last cell in row does not move', () => {
  const t = makeTable();
  const rowCells = cells(rows(t)[0]);
  const lastCell = rowCells[rowCells.length - 1];

  /** @type {any} */ (globalThis)._lastFocused = lastCell;
  fireEvent(getByRole(t, 'grid'), 'keydown', { key: 'ArrowRight' });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    lastCell,
    'ArrowRight at last cell must not move'
  );
});

test('CORADataTable: ArrowLeft at first cell does not move', () => {
  const t = makeTable();
  const firstCell = cells(rows(t)[0])[0];

  /** @type {any} */ (globalThis)._lastFocused = firstCell;
  fireEvent(getByRole(t, 'grid'), 'keydown', { key: 'ArrowLeft' });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    firstCell,
    'ArrowLeft at first cell must not move'
  );
});

test('CORADataTable: ArrowUp at first row does not move', () => {
  const t = makeTable();
  const firstCell = cells(rows(t)[0])[0];

  /** @type {any} */ (globalThis)._lastFocused = firstCell;
  fireEvent(getByRole(t, 'grid'), 'keydown', { key: 'ArrowUp' });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    firstCell,
    'ArrowUp at first row must not move'
  );
});

test('CORADataTable: ArrowDown at last row does not move', () => {
  const t = makeTable();
  const tableRows = rows(t);
  const lastCell = cells(tableRows[tableRows.length - 1])[0];

  /** @type {any} */ (globalThis)._lastFocused = lastCell;
  fireEvent(getByRole(t, 'grid'), 'keydown', { key: 'ArrowDown' });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    lastCell,
    'ArrowDown at last row must not move'
  );
});

test('CORADataTable: arrow key with no focused cell does nothing', () => {
  const t = makeTable();

  /** @type {any} */ (globalThis)._lastFocused = null;
  fireEvent(getByRole(t, 'grid'), 'keydown', { key: 'ArrowRight' });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    null,
    'no focused cell — must be a no-op'
  );
});

test('CORADataTable: arrow key with no columns is a no-op', () => {
  const t = new CORADataTable();
  t.columns = [];
  t.rows = [];
  t.connectedCallback();
  /** @type {any} */ (globalThis)._lastFocused = null;
  fireEvent(getByRole(t, 'grid'), 'keydown', { key: 'ArrowDown' });
  assert.equal(/** @type {any} */ (globalThis)._lastFocused, null);
});

test('CORADataTable: sort with null getValue col is unsortable', () => {
  const t = new CORADataTable();
  // Column declared sortable but has no getValue
  t.columns = [{ key: 'x', label: 'X', sortable: true }];
  t.rows = [{ x: 3 }, { x: 1 }, { x: 2 }];
  t.sort = { key: 'x' };
  t.connectedCallback();
  // Without getValue, rows are unsorted (original order preserved)
  assert.equal(rows(t).length, 3);
});

test('CORADataTable: sort comparator handles null values (nulls sort last)', () => {
  const t = new CORADataTable();
  t.columns = [
    {
      key: 'n',
      label: 'N',
      sortable: true,
      getValue: (/** @type {any} */ r) => r.n,
    },
  ];
  t.rows = [{ n: 5 }, { n: null }, { n: 2 }];
  t.sort = { key: 'n', dir: 'asc' };
  t.connectedCallback();
  const vals = firstColumnValues(t);
  assert.equal(vals[0], '2', 'smallest non-null first');
  assert.equal(vals[vals.length - 1], '—', 'null last');
});

test('CORADataTable: sort comparator where both values are null keeps order stable', () => {
  const t = new CORADataTable();
  t.columns = [
    {
      key: 'n',
      label: 'N',
      sortable: true,
      getValue: (/** @type {any} */ r) => r.n ?? null,
    },
  ];
  t.rows = [{ n: null }, { n: null }];
  t.sort = { key: 'n', dir: 'asc' };
  t.connectedCallback();
  assert.equal(rows(t).length, 2, 'both-null comparison returns 0');
});

test('CORADataTable: sort comparator returns 0 for equal non-null values (stable)', () => {
  const t = new CORADataTable();
  t.columns = [
    {
      key: 'n',
      label: 'N',
      sortable: true,
      getValue: (/** @type {any} */ r) => r.n,
    },
  ];
  t.rows = [
    { n: 5, id: 'a' },
    { n: 5, id: 'b' },
  ];
  t.sort = { key: 'n', dir: 'asc' };
  t.connectedCallback();
  // Both have equal value 5; comparator returns 0 — order is implementation-defined but no crash
  assert.equal(rows(t).length, 2, 'equal non-null values: both rows remain');
});

test('CORADataTable: set rowClass to null falls back to no-op class function', () => {
  const t = new CORADataTable();
  t.columns = [
    { key: 'n', label: 'N', getValue: (/** @type {any} */ r) => r.n },
  ];
  t.rowClass = /** @type {any} */ (null); // covers `fn || (() => '')` when fn is falsy
  t.rows = [{ n: 1 }];
  t.connectedCallback();
  // Fallback (() => '') called during _renderBody — tr.className stays ''
  assert.equal(
    rows(t)[0].className,
    '',
    'null rowClass must leave className empty'
  );
});

test('CORADataTable: row keydown with non-Enter key is a no-op when onRowActivate is set', () => {
  const t = new CORADataTable();
  t.columns = [
    { key: 'n', label: 'N', getValue: (/** @type {any} */ r) => r.n },
  ];
  /** @type {any[]} */
  const activated = [];
  t.onRowActivate = (r) => activated.push(r);
  t.rows = [{ n: 1 }];
  t.connectedCallback();
  fireEvent(rows(t)[0], 'keydown', { key: 'Space' });
  assert.equal(
    activated.length,
    0,
    'non-Enter keydown must not activate the row'
  );
});
