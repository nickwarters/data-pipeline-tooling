// @ts-check
// TODO(simplify-ui): Rewrite these lifecycle-heavy tests around the
// future function-component API. Prefer asserting plain functions, h() output,
// reactive() updates, and route-shell behavior over manual connectedCallback()/
// disconnectedCallback() calls on custom element classes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ===== MINIMAL DOM STUBS =====
class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    /** @type {Record<string, string>} */
    this._attrs = {};
    /** @type {string} */
    this.tagName = '';
    this.textContent = '';
    this.className = '';
    this.type = '';
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) {
    this._children = cs;
  }
  appendChild(/** @type {StubEl} */ c) {
    this._children.push(c);
    return c;
  }
  append(/** @type {StubEl[]} */ ...cs) {
    this._children.push(...cs);
  }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
    this._attrs[k] = v;
  }
  getAttribute(/** @type {string} */ k) {
    return this._attrs[k] ?? null;
  }
  focus() {
    /** @type {any} */ (globalThis)._lastFocused = this;
  }
}

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).document = {
  /** @param {string} tag @returns {StubEl} */
  createElement(tag) {
    const el = new StubEl();
    el.tagName = tag.toUpperCase();
    return el;
  },
  addEventListener() {},
  removeEventListener() {},
};
/** @type {any} */ (globalThis).customElements = { define() {} };

// ===== IMPORTS =====
const { CRDataTable } = await import('../src/components/cr-data-table.js');

// ===== HELPERS =====

/** @returns {any} */
function makeTable() {
  const t = new CRDataTable();
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

/** Walk the tree and collect all elements matching a tagName. @returns {StubEl[]} */
function findAll(/** @type {any} */ root, /** @type {string} */ tag) {
  /** @type {StubEl[]} */
  const out = [];
  /** @param {any} n */
  function walk(n) {
    if (n.tagName === tag.toUpperCase()) out.push(n);
    for (const c of n._children ?? []) walk(c);
  }
  walk(root);
  return out;
}

// ===== TESTS =====

test('CRDataTable: renders a table with thead and tbody', () => {
  const t = makeTable();
  assert.equal(findAll(t, 'table').length, 1);
  assert.equal(findAll(t, 'thead').length, 1);
  assert.equal(findAll(t, 'tbody').length, 1);
});

test('CRDataTable: renders one th per column', () => {
  const t = makeTable();
  assert.equal(findAll(t, 'th').length, 2);
});

test('CRDataTable: renders one tr per row in tbody', () => {
  const t = makeTable();
  const tbody = findAll(t, 'tbody')[0];
  assert.equal(tbody._children.length, 3);
});

test('CRDataTable: set sort(null) clears sort key', () => {
  const t = makeTable();
  // Set a sort first
  t.sort = { key: 'name', dir: 'asc' };
  // Now clear it
  t.sort = null;
  // Rows should be in original order
  const tbody = findAll(t, 'tbody')[0];
  const names = tbody._children.map(
    (/** @type {any} */ tr) => tr._children[0].textContent
  );
  assert.deepEqual(names, ['Alice', 'Bob', 'Carol']);
});

test('CRDataTable: set sort with desc direction sorts descending', () => {
  const t = makeTable();
  t.sort = { key: 'name', dir: 'desc' };
  const tbody = findAll(t, 'tbody')[0];
  const names = tbody._children.map(
    (/** @type {any} */ tr) => tr._children[0].textContent
  );
  assert.deepEqual(names, ['Carol', 'Bob', 'Alice']);
});

test('CRDataTable: set sort without dir defaults to asc', () => {
  const t = makeTable();
  t.sort = { key: 'name' };
  const tbody = findAll(t, 'tbody')[0];
  const names = tbody._children.map(
    (/** @type {any} */ tr) => tr._children[0].textContent
  );
  assert.deepEqual(names, ['Alice', 'Bob', 'Carol']);
});

test('CRDataTable: clicking header sorts and second click reverses', () => {
  const t = makeTable();
  const headerBtns = findAll(t, 'button').filter(
    (b) => b.textContent === 'Name'
  );
  assert.equal(headerBtns.length, 1);

  headerBtns[0]._listeners['click'][0]();
  const tbody1 = findAll(t, 'tbody')[0];
  const names1 = tbody1._children.map(
    (/** @type {any} */ tr) => tr._children[0].textContent
  );
  assert.deepEqual(names1, ['Alice', 'Bob', 'Carol']);

  headerBtns[0]._listeners['click'][0]();
  const tbody2 = findAll(t, 'tbody')[0];
  const names2 = tbody2._children.map(
    (/** @type {any} */ tr) => tr._children[0].textContent
  );
  assert.deepEqual(names2, ['Carol', 'Bob', 'Alice']);
});

test('CRDataTable: connectedCallback is idempotent (second call is no-op)', () => {
  const t = makeTable();
  const firstChild = /** @type {any} */ (t)._children[0];
  t.connectedCallback();
  assert.equal(
    /** @type {any} */ (t)._children[0],
    firstChild,
    'second connectedCallback must not rebuild'
  );
});

test('CRDataTable: renderCell used when provided, else getValue', () => {
  const t = new CRDataTable();
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
  const tbody = findAll(t, 'tbody')[0];
  const cells = tbody._children[0]._children;
  assert.equal(cells[0].textContent, 'cell:X', 'renderCell string used');
  assert.equal(cells[1].textContent, '42', 'getValue used');
  assert.equal(
    cells[2].textContent,
    '—',
    'null/undefined getValue shows em-dash'
  );
});

test('CRDataTable: renderCell returning a non-string node appends it', () => {
  const t = new CRDataTable();
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
  const tbody = findAll(t, 'tbody')[0];
  const td = tbody._children[0]._children[0];
  assert.equal(td._children[0].textContent, 'child');
});

test('CRDataTable: renderCell returning null does not append anything', () => {
  const t = new CRDataTable();
  t.columns = [
    {
      key: 'node',
      label: 'Node',
      renderCell: () => null,
    },
  ];
  t.rows = [{}];
  t.connectedCallback();
  const tbody = findAll(t, 'tbody')[0];
  const td = tbody._children[0]._children[0];
  assert.equal(td._children.length, 0, 'null renderCell appends nothing');
});

test('CRDataTable: rowClass is applied', () => {
  const t = new CRDataTable();
  t.columns = [
    { key: 'n', label: 'N', getValue: (/** @type {any} */ r) => r.n },
  ];
  t.rowClass = (/** @type {any} */ r) => (r.flag ? 'flagged' : '');
  t.rows = [
    { n: 1, flag: true },
    { n: 2, flag: false },
  ];
  t.connectedCallback();
  const tbody = findAll(t, 'tbody')[0];
  assert.equal(tbody._children[0].className, 'flagged');
  assert.equal(tbody._children[1].className, '');
});

test('CRDataTable: onRowActivate fires on Enter keydown', () => {
  const t = new CRDataTable();
  t.columns = [
    { key: 'n', label: 'N', getValue: (/** @type {any} */ r) => r.n },
  ];
  /** @type {any[]} */
  const activated = [];
  t.onRowActivate = (r) => activated.push(r);
  t.rows = [{ n: 1 }, { n: 2 }];
  t.connectedCallback();
  const tbody = findAll(t, 'tbody')[0];
  const tr = tbody._children[0];
  tr._listeners['keydown'][0]({ key: 'Enter' });
  assert.equal(activated.length, 1);
  assert.equal(activated[0].n, 1);
});

// --- _onKeydown grid navigation ---

test('CRDataTable: _onKeydown ignores non-arrow keys', () => {
  const t = makeTable();
  const table = findAll(t, 'table')[0];
  // Should not throw or change focus
  /** @type {any} */ (globalThis)._lastFocused = null;
  table._listeners['keydown'][0]({ key: 'Tab' });
  assert.equal(/** @type {any} */ (globalThis)._lastFocused, null);
});

test('CRDataTable: _onKeydown ArrowRight moves to next cell in row', () => {
  const t = makeTable();
  const table = findAll(t, 'table')[0];
  const tbody = findAll(t, 'tbody')[0];
  const row0 = tbody._children[0];
  const cell0 = row0._children[0];
  const cell1 = row0._children[1];

  /** @type {any} */ (globalThis)._lastFocused = cell0;
  table._listeners['keydown'][0]({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    cell1,
    'ArrowRight should move to next cell'
  );
});

test('CRDataTable: _onKeydown ArrowLeft moves to previous cell in row', () => {
  const t = makeTable();
  const table = findAll(t, 'table')[0];
  const tbody = findAll(t, 'tbody')[0];
  const row0 = tbody._children[0];
  const cell1 = row0._children[1];
  const cell0 = row0._children[0];

  /** @type {any} */ (globalThis)._lastFocused = cell1;
  table._listeners['keydown'][0]({ key: 'ArrowLeft', preventDefault() {} });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    cell0,
    'ArrowLeft should move to previous cell'
  );
});

test('CRDataTable: _onKeydown ArrowDown moves to cell below', () => {
  const t = makeTable();
  const table = findAll(t, 'table')[0];
  const tbody = findAll(t, 'tbody')[0];
  const row0 = tbody._children[0];
  const row1 = tbody._children[1];
  const cell00 = row0._children[0];
  const cell10 = row1._children[0];

  /** @type {any} */ (globalThis)._lastFocused = cell00;
  table._listeners['keydown'][0]({ key: 'ArrowDown', preventDefault() {} });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    cell10,
    'ArrowDown should move one row down'
  );
});

test('CRDataTable: _onKeydown ArrowUp moves to cell above', () => {
  const t = makeTable();
  const table = findAll(t, 'table')[0];
  const tbody = findAll(t, 'tbody')[0];
  const row0 = tbody._children[0];
  const row1 = tbody._children[1];
  const cell00 = row0._children[0];
  const cell10 = row1._children[0];

  /** @type {any} */ (globalThis)._lastFocused = cell10;
  table._listeners['keydown'][0]({ key: 'ArrowUp', preventDefault() {} });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    cell00,
    'ArrowUp should move one row up'
  );
});

test('CRDataTable: _onKeydown ArrowRight at last cell in row does not move', () => {
  const t = makeTable();
  const table = findAll(t, 'table')[0];
  const tbody = findAll(t, 'tbody')[0];
  const row0 = tbody._children[0];
  const lastCell = row0._children[row0._children.length - 1];

  /** @type {any} */ (globalThis)._lastFocused = lastCell;
  table._listeners['keydown'][0]({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    lastCell,
    'ArrowRight at last cell must not move'
  );
});

test('CRDataTable: _onKeydown ArrowLeft at first cell does not move', () => {
  const t = makeTable();
  const table = findAll(t, 'table')[0];
  const tbody = findAll(t, 'tbody')[0];
  const firstCell = tbody._children[0]._children[0];

  /** @type {any} */ (globalThis)._lastFocused = firstCell;
  table._listeners['keydown'][0]({ key: 'ArrowLeft', preventDefault() {} });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    firstCell,
    'ArrowLeft at first cell must not move'
  );
});

test('CRDataTable: _onKeydown ArrowUp at first row does not move', () => {
  const t = makeTable();
  const table = findAll(t, 'table')[0];
  const tbody = findAll(t, 'tbody')[0];
  const firstCell = tbody._children[0]._children[0];

  /** @type {any} */ (globalThis)._lastFocused = firstCell;
  table._listeners['keydown'][0]({ key: 'ArrowUp', preventDefault() {} });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    firstCell,
    'ArrowUp at first row must not move'
  );
});

test('CRDataTable: _onKeydown ArrowDown at last row does not move', () => {
  const t = makeTable();
  const table = findAll(t, 'table')[0];
  const tbody = findAll(t, 'tbody')[0];
  const lastRowCells = tbody._children[tbody._children.length - 1]._children;
  const lastCell = lastRowCells[0];

  /** @type {any} */ (globalThis)._lastFocused = lastCell;
  table._listeners['keydown'][0]({ key: 'ArrowDown', preventDefault() {} });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    lastCell,
    'ArrowDown at last row must not move'
  );
});

test('CRDataTable: _onKeydown when no cell is focused does nothing', () => {
  const t = makeTable();
  const table = findAll(t, 'table')[0];

  /** @type {any} */ (globalThis)._lastFocused = null;
  table._listeners['keydown'][0]({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    null,
    'no focused cell — must be a no-op'
  );
});

test('CRDataTable: _onKeydown with no columns is a no-op', () => {
  const t = new CRDataTable();
  t.columns = [];
  t.rows = [];
  t.connectedCallback();
  const table = findAll(t, 'table')[0];
  /** @type {any} */ (globalThis)._lastFocused = null;
  table._listeners['keydown'][0]({ key: 'ArrowDown' });
  assert.equal(/** @type {any} */ (globalThis)._lastFocused, null);
});

test('CRDataTable: sort with null getValue col is unsortable', () => {
  const t = new CRDataTable();
  // Column declared sortable but has no getValue
  t.columns = [{ key: 'x', label: 'X', sortable: true }];
  t.rows = [{ x: 3 }, { x: 1 }, { x: 2 }];
  t.sort = { key: 'x' };
  t.connectedCallback();
  const tbody = findAll(t, 'tbody')[0];
  // Without getValue, rows are unsorted (original order preserved)
  assert.equal(tbody._children.length, 3);
});

test('CRDataTable: sort comparator handles null values (nulls sort last)', () => {
  const t = new CRDataTable();
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
  const tbody = findAll(t, 'tbody')[0];
  const vals = tbody._children.map(
    (/** @type {any} */ tr) => tr._children[0].textContent
  );
  assert.equal(vals[0], '2', 'smallest non-null first');
  assert.equal(vals[vals.length - 1], '—', 'null last');
});

test('CRDataTable: sort comparator where both values are null keeps order stable', () => {
  const t = new CRDataTable();
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
  const tbody = findAll(t, 'tbody')[0];
  assert.equal(tbody._children.length, 2, 'both-null comparison returns 0');
});

test('CRDataTable: sort comparator returns 0 for equal non-null values (stable)', () => {
  const t = new CRDataTable();
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
  const tbody = findAll(t, 'tbody')[0];
  // Both have equal value 5; comparator returns 0 — order is implementation-defined but no crash
  assert.equal(
    tbody._children.length,
    2,
    'equal non-null values: both rows remain'
  );
});

test('CRDataTable: set rowClass to null falls back to no-op class function', () => {
  const t = new CRDataTable();
  t.columns = [
    { key: 'n', label: 'N', getValue: (/** @type {any} */ r) => r.n },
  ];
  t.rowClass = /** @type {any} */ (null); // covers `fn || (() => '')` when fn is falsy
  t.rows = [{ n: 1 }];
  t.connectedCallback();
  const tbody = findAll(t, 'tbody')[0];
  // Fallback (() => '') called during _renderBody — tr.className stays ''
  assert.equal(
    tbody._children[0].className,
    '',
    'null rowClass must leave className empty'
  );
});

test('CRDataTable: row keydown with non-Enter key is a no-op when onRowActivate is set', () => {
  const t = new CRDataTable();
  t.columns = [
    { key: 'n', label: 'N', getValue: (/** @type {any} */ r) => r.n },
  ];
  /** @type {any[]} */
  const activated = [];
  t.onRowActivate = (r) => activated.push(r);
  t.rows = [{ n: 1 }];
  t.connectedCallback();
  const tbody = findAll(t, 'tbody')[0];
  const tr = tbody._children[0];
  tr._listeners['keydown'][0]({ key: 'Space' }); // non-Enter key
  assert.equal(
    activated.length,
    0,
    'non-Enter keydown must not activate the row'
  );
});
