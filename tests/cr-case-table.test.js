// @ts-check
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
    this.href = '';
    this.hidden = false;
    this.disabled = false;
    this.type = '';
    this.value = '';
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) { this._children = cs; }
  appendChild(/** @type {StubEl} */ c) { this._children.push(c); return c; }
  append(/** @type {StubEl[]} */ ...cs) { this._children.push(...cs); }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this._attrs[k] = v; }
  getAttribute(/** @type {string} */ k) { return this._attrs[k] ?? null; }
  dispatchEvent(/** @type {any} */ e) {
    (this._listeners[e.type] ?? []).forEach(h => h(e));
    return true;
  }
  focus() {}
}

class StubCustomEvent {
  /** @param {string} type @param {{ detail?: any, bubbles?: boolean }} [init] */
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail ?? null;
    this.bubbles = init?.bubbles ?? false;
  }
}

(/** @type {any} */ (globalThis)).HTMLElement = StubEl;
(/** @type {any} */ (globalThis)).document = {
  /** @param {string} tag @returns {StubEl} */
  createElement(tag) {
    const el = new StubEl();
    el.tagName = tag.toUpperCase();
    return el;
  },
  addEventListener() {},
  removeEventListener() {},
};
(/** @type {any} */ (globalThis)).customElements = { define() {} };
(/** @type {any} */ (globalThis)).location = { hash: '' };
(/** @type {any} */ (globalThis)).CustomEvent = StubCustomEvent;

// ===== IMPORTS (after stubs) =====
const { CRCaseTable } = await import('../src/components/cr-case-table.js');

// ===== HELPERS =====
/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

/**
 * Walk the tree and collect all elements with matching tagName.
 * @param {any} root
 * @param {string} tag
 * @returns {StubEl[]}
 */
function findAll(root, tag) {
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

/** @param {any} root @param {string} tag @returns {StubEl | undefined} */
function findFirst(root, tag) { return findAll(root, tag)[0]; }

/** @returns {CaseRow} */
function makeCase(overrides = {}) {
  return {
    id: 'case-1',
    caseType: 'hello-review',
    title: 'Hello Review #1',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-a',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    created: '2026-05-01T08:00:00Z',
    dueDate: '2026-06-01',
    etag: 'etag-1',
    ...overrides,
  };
}

// ===== TESTS =====

test('CRCaseTable: connectedCallback renders a table element', () => {
  const el = new CRCaseTable();
  el.cases = [makeCase()];
  el.connectedCallback();
  const tables = findAll(el, 'table');
  assert.equal(tables.length, 1, 'should render one table');
});

test('CRCaseTable: renders header row with expected column labels', () => {
  const el = new CRCaseTable();
  el.cases = [];
  el.connectedCallback();
  const buttons = findAll(el, 'button').filter(b => b.className !== 'cr-case-open-btn');
  const labels = buttons.map(b => b.textContent);
  assert.ok(labels.includes('Reference'), 'should have Reference column');
  assert.ok(labels.includes('Case Type'), 'should have Case Type column');
  assert.ok(labels.includes('Due Date'), 'should have Due Date column');
  assert.ok(labels.includes('Status'), 'should have Status column');
});

test('CRCaseTable: renders one row per case', () => {
  const el = new CRCaseTable();
  el.cases = [
    makeCase({ id: 'c1', title: 'Case A' }),
    makeCase({ id: 'c2', title: 'Case B' }),
    makeCase({ id: 'c3', title: 'Case C' }),
  ];
  el.connectedCallback();
  const rows = findAll(el, 'tr').filter(r => r.className === 'cr-case-row');
  assert.equal(rows.length, 3, 'should render three case rows');
});

test('CRCaseTable: row contains a link to the case', () => {
  const el = new CRCaseTable();
  el.cases = [makeCase({ id: 'case-42', title: 'Test Case' })];
  el.connectedCallback();
  const links = findAll(el, 'a');
  assert.equal(links.length, 1, 'should render one link');
  assert.equal(links[0].href, '#/case/case-42', 'link should point to case route');
});

test('CRCaseTable: free-text filter hides non-matching rows', () => {
  const el = new CRCaseTable();
  el.cases = [
    makeCase({ id: 'c1', title: 'Alpha Review', caseType: 'hello-review' }),
    makeCase({ id: 'c2', title: 'Beta Review', caseType: 'goodbye-review' }),
  ];
  el.connectedCallback();

  // Simulate filter input event
  const filterInput = /** @type {any} */ (findFirst(el, 'input'));
  assert.ok(filterInput, 'should have filter input');
  filterInput.value = 'alpha';
  for (const h of filterInput._listeners['input'] ?? []) {
    h({ target: filterInput });
  }

  const rows = findAll(el, 'tr').filter(r => r.className === 'cr-case-row');
  assert.equal(rows.length, 1, 'only the matching row should be visible');
  assert.equal(findAll(rows[0], 'a')[0]?.href, '#/case/c1');
});

test('CRCaseTable: free-text filter matches case type', () => {
  const el = new CRCaseTable();
  el.cases = [
    makeCase({ id: 'c1', title: 'Case One', caseType: 'hello-review' }),
    makeCase({ id: 'c2', title: 'Case Two', caseType: 'goodbye-review' }),
  ];
  el.connectedCallback();

  const filterInput = /** @type {any} */ (findFirst(el, 'input'));
  filterInput.value = 'goodbye';
  for (const h of filterInput._listeners['input'] ?? []) {
    h({ target: filterInput });
  }

  const rows = findAll(el, 'tr').filter(r => r.className === 'cr-case-row');
  assert.equal(rows.length, 1, 'should match by case type');
  assert.equal(findAll(rows[0], 'a')[0]?.href, '#/case/c2');
});

test('CRCaseTable: status filter shows only matching rows', () => {
  const el = new CRCaseTable();
  el.cases = [
    makeCase({ id: 'c1', status: 'In-progress' }),
    makeCase({ id: 'c2', status: 'Completed' }),
    makeCase({ id: 'c3', status: 'In-progress' }),
  ];
  el.connectedCallback();

  const statusSelect = /** @type {any} */ (findFirst(el, 'select'));
  assert.ok(statusSelect, 'should have status filter select');
  statusSelect.value = 'Completed';
  for (const h of statusSelect._listeners['change'] ?? []) {
    h({ target: statusSelect });
  }

  const rows = findAll(el, 'tr').filter(r => r.className === 'cr-case-row');
  assert.equal(rows.length, 1, 'only completed cases should be visible');
  assert.equal(findAll(rows[0], 'a')[0]?.href, '#/case/c2');
});

test('CRCaseTable: status filter cleared shows all rows', () => {
  const el = new CRCaseTable();
  el.cases = [
    makeCase({ id: 'c1', status: 'In-progress' }),
    makeCase({ id: 'c2', status: 'Completed' }),
  ];
  el.connectedCallback();

  const statusSelect = /** @type {any} */ (findFirst(el, 'select'));
  // Apply filter
  statusSelect.value = 'Completed';
  for (const h of statusSelect._listeners['change'] ?? []) {
    h({ target: statusSelect });
  }
  // Clear filter
  statusSelect.value = '';
  for (const h of statusSelect._listeners['change'] ?? []) {
    h({ target: statusSelect });
  }

  const rows = findAll(el, 'tr').filter(r => r.className === 'cr-case-row');
  assert.equal(rows.length, 2, 'all rows should be visible after clearing filter');
});

test('CRCaseTable: sorting by Reference column sorts rows alphabetically', () => {
  const el = new CRCaseTable();
  el.cases = [
    makeCase({ id: 'c1', title: 'Zebra Case' }),
    makeCase({ id: 'c2', title: 'Alpha Case' }),
    makeCase({ id: 'c3', title: 'Mango Case' }),
  ];
  el.connectedCallback();

  // Click the Reference sort button
  const headerBtns = findAll(el, 'button').filter(b => b.textContent === 'Reference');
  assert.equal(headerBtns.length, 1, 'should have Reference sort button');
  for (const h of headerBtns[0]._listeners['click'] ?? []) h();

  const rows = findAll(el, 'tr').filter(r => r.className === 'cr-case-row');
  const links = rows.map(r => findAll(r, 'a')[0]?.textContent);
  assert.deepEqual(links, ['Alpha Case', 'Mango Case', 'Zebra Case'], 'rows should be sorted asc by reference');
});

test('CRCaseTable: second click on same column reverses sort direction', () => {
  const el = new CRCaseTable();
  el.cases = [
    makeCase({ id: 'c1', title: 'Zebra Case' }),
    makeCase({ id: 'c2', title: 'Alpha Case' }),
  ];
  el.connectedCallback();

  const refBtn = findAll(el, 'button').find(b => b.textContent === 'Reference');
  assert.ok(refBtn);

  // First click: asc
  for (const h of refBtn._listeners['click'] ?? []) h();
  // Second click: desc
  for (const h of refBtn._listeners['click'] ?? []) h();

  const rows = findAll(el, 'tr').filter(r => r.className === 'cr-case-row');
  const links = rows.map(r => findAll(r, 'a')[0]?.textContent);
  assert.deepEqual(links, ['Zebra Case', 'Alpha Case'], 'rows should be sorted desc after second click');
});

test('CRCaseTable: clicking a different column resets sort to asc', () => {
  const el = new CRCaseTable();
  el.cases = [
    makeCase({ id: 'c1', title: 'B Case', status: 'In-progress', caseType: 'zzz-review' }),
    makeCase({ id: 'c2', title: 'A Case', status: 'Completed', caseType: 'aaa-review' }),
  ];
  el.connectedCallback();

  // Sort by Reference descending
  const refBtn = findAll(el, 'button').find(b => b.textContent === 'Reference');
  assert.ok(refBtn);
  for (const h of refBtn._listeners['click'] ?? []) h(); // asc
  for (const h of refBtn._listeners['click'] ?? []) h(); // desc

  // Switch to Case Type sort
  const typeBtn = findAll(el, 'button').find(b => b.textContent === 'Case Type');
  assert.ok(typeBtn);
  for (const h of typeBtn._listeners['click'] ?? []) h();

  const rows = findAll(el, 'tr').filter(r => r.className === 'cr-case-row');
  const links = rows.map(r => findAll(r, 'a')[0]?.textContent);
  assert.deepEqual(links, ['A Case', 'B Case'], 'switching columns should reset to asc');
});

test('CRCaseTable: aria-sort reflects current sort column and direction', () => {
  const el = new CRCaseTable();
  el.cases = [makeCase()];
  el.connectedCallback();

  // Initial state: reference column sorted asc (default)
  const theadRow = findFirst(el, 'thead')?._children[0];
  assert.ok(theadRow, 'should have thead row');

  // Click Reference to sort asc
  const refBtn = findAll(el, 'button').find(b => b.textContent === 'Reference');
  assert.ok(refBtn);
  for (const h of refBtn._listeners['click'] ?? []) h();

  // Find the Reference th (first th with cr-col-reference class)
  const allTh = findAll(el, 'th');
  const refTh = allTh.find(th => th.className === 'cr-col-reference');
  assert.ok(refTh, 'should find Reference th');
  assert.equal(refTh.getAttribute('aria-sort'), 'ascending', 'active column should be ascending');

  // Other columns should be none
  const statusTh = allTh.find(th => th.className === 'cr-col-status');
  assert.ok(statusTh);
  assert.equal(statusTh.getAttribute('aria-sort'), 'none', 'inactive column should be none');

  // Click again: desc
  for (const h of refBtn._listeners['click'] ?? []) h();
  assert.equal(refTh.getAttribute('aria-sort'), 'descending', 'should be descending after second click');
});

test('CRCaseTable: dispatches cr-case-open event when Open button is clicked', () => {
  const el = new CRCaseTable();
  el.cases = [makeCase({ id: 'case-99' })];
  el.connectedCallback();

  /** @type {any[]} */
  const dispatched = [];
  el.addEventListener('cr-case-open', e => dispatched.push(e));

  const openBtns = findAll(el, 'button').filter(b => b.className === 'cr-case-open-btn');
  assert.equal(openBtns.length, 1, 'should have one Open button');
  for (const h of openBtns[0]._listeners['click'] ?? []) h();

  assert.equal(dispatched.length, 1, 'should dispatch cr-case-open once');
  assert.equal(dispatched[0].detail.caseId, 'case-99');
});

test('CRCaseTable: dispatches cr-case-open when Enter pressed on a row', () => {
  const el = new CRCaseTable();
  el.cases = [makeCase({ id: 'case-77' })];
  el.connectedCallback();

  /** @type {any[]} */
  const dispatched = [];
  el.addEventListener('cr-case-open', e => dispatched.push(e));

  const rows = findAll(el, 'tr').filter(r => r.className === 'cr-case-row');
  assert.equal(rows.length, 1);
  for (const h of rows[0]._listeners['keydown'] ?? []) {
    h({ key: 'Enter' });
  }

  assert.equal(dispatched.length, 1, 'should dispatch cr-case-open on Enter');
  assert.equal(dispatched[0].detail.caseId, 'case-77');
});

test('CRCaseTable: setting cases after connectedCallback re-renders rows', () => {
  const el = new CRCaseTable();
  el.cases = [];
  el.connectedCallback();

  let rows = findAll(el, 'tr').filter(r => r.className === 'cr-case-row');
  assert.equal(rows.length, 0, 'initially empty');

  el.cases = [makeCase({ id: 'c1' }), makeCase({ id: 'c2' })];

  rows = findAll(el, 'tr').filter(r => r.className === 'cr-case-row');
  assert.equal(rows.length, 2, 'should re-render when cases are updated');
});

test('CRCaseTable: filter input has aria-label', () => {
  const el = new CRCaseTable();
  el.cases = [];
  el.connectedCallback();
  const input = findFirst(el, 'input');
  assert.ok(input, 'should have input');
  assert.equal(input.getAttribute('aria-label'), 'Filter cases', 'filter input needs aria-label');
});

test('CRCaseTable: status select has aria-label', () => {
  const el = new CRCaseTable();
  el.cases = [];
  el.connectedCallback();
  const select = findFirst(el, 'select');
  assert.ok(select, 'should have select');
  assert.equal(select.getAttribute('aria-label'), 'Filter by status', 'select needs aria-label');
});

test('CRCaseTable: custom columns override defaults', () => {
  const el = new CRCaseTable();
  /** @type {any} */ (el).columns = [
    { key: 'reference', label: 'Ref', getValue: (/** @type {any} */ r) => r.title },
    { key: 'caseType', label: 'Type', getValue: (/** @type {any} */ r) => r.caseType },
  ];
  el.cases = [makeCase({ id: 'c1', title: 'My Case', caseType: 'audit' })];
  el.connectedCallback();
  const ths = findAll(el, 'th');
  assert.equal(ths.length, 2, 'should render only the two custom columns');
  const rows = findAll(el, 'tr');
  // 1 header row + 1 data row
  assert.equal(rows.length, 2);
});

test('CRCaseTable: rowClass is applied to data rows', () => {
  const el = new CRCaseTable();
  /** @type {any} */ (el).columns = [
    { key: 'reference', label: 'Ref', getValue: (/** @type {any} */ r) => r.title },
  ];
  /** @type {any} */ (el).rowClass = (/** @type {any} */ r) => r.id === 'flag' ? 'cr-flagged' : '';
  el.cases = [
    makeCase({ id: 'flag', title: 'Flagged' }),
    makeCase({ id: 'ok', title: 'Normal' }),
  ];
  el.connectedCallback();
  const dataRows = findAll(el, 'tr').filter(r => r._children[0]?.tagName === 'TD');
  assert.equal(dataRows.length, 2);
  assert.equal(dataRows[0].className, 'cr-flagged');
  assert.equal(dataRows[1].className, '');
});

test('CRCaseTable: hidden toolbar omits filter input and status select', () => {
  const el = new CRCaseTable();
  /** @type {any} */ (el).toolbar = 'hidden';
  /** @type {any} */ (el).columns = [
    { key: 'reference', label: 'Ref', getValue: (/** @type {any} */ r) => r.title },
  ];
  el.cases = [makeCase()];
  el.connectedCallback();
  assert.equal(findFirst(el, 'input'), undefined, 'no filter input when hidden');
  assert.equal(findFirst(el, 'select'), undefined, 'no status select when hidden');
});

test('CRCaseTable: initial sort prop drives default order', () => {
  const el = new CRCaseTable();
  /** @type {any} */ (el).columns = [
    { key: 'reference', label: 'Ref', sortable: true, getValue: (/** @type {any} */ r) => r.title },
  ];
  /** @type {any} */ (el).sort = { key: 'reference', dir: 'desc' };
  el.cases = [
    makeCase({ id: 'a', title: 'Alpha' }),
    makeCase({ id: 'b', title: 'Beta' }),
    makeCase({ id: 'c', title: 'Gamma' }),
  ];
  el.connectedCallback();
  const dataRows = findAll(el, 'tr').filter(r => r._children[0]?.tagName === 'TD');
  const titles = dataRows.map(r => r._children[0].textContent);
  assert.deepEqual(titles, ['Gamma', 'Beta', 'Alpha']);
});

test('CRCaseTable: case with empty title falls back to id in Open button aria-label', () => {
  const el = new CRCaseTable();
  el.cases = [makeCase({ id: 'case-no-title', title: '' })];
  el.connectedCallback();
  const openBtn = findAll(el, 'button').find(b => b.className === 'cr-case-open-btn');
  assert.ok(openBtn, 'should have open button');
  assert.equal(openBtn._attrs['aria-label'], 'Open case-no-title');
});

test('CRCaseTable: filter input event with null target falls back to empty string', () => {
  const el = new CRCaseTable();
  el.cases = [makeCase({ id: 'c1', title: 'Alpha' }), makeCase({ id: 'c2', title: 'Beta' })];
  el.connectedCallback();

  const filterInput = /** @type {any} */ (findFirst(el, 'input'));
  // Fire event with null target — covers `e.target?.value ?? ''` null branch
  for (const h of filterInput._listeners['input'] ?? []) {
    h({ target: null });
  }
  // Empty string filter shows all rows
  const rows = findAll(el, 'tr').filter(r => r.className === 'cr-case-row');
  assert.equal(rows.length, 2);
});

test('CRCaseTable: status filter event with null target falls back to empty string', () => {
  const el = new CRCaseTable();
  el.cases = [makeCase({ id: 'c1', status: 'In-progress' }), makeCase({ id: 'c2', status: 'Completed' })];
  el.connectedCallback();

  const statusSelect = /** @type {any} */ (findFirst(el, 'select'));
  // Fire event with null target — covers `e.target?.value ?? ''` null branch
  for (const h of statusSelect._listeners['change'] ?? []) {
    h({ target: null });
  }
  // Empty string filter shows all rows
  const rows = findAll(el, 'tr').filter(r => r.className === 'cr-case-row');
  assert.equal(rows.length, 2);
});

test('CRCaseTable: free-text filter matches by status field', () => {
  const el = new CRCaseTable();
  el.cases = [
    makeCase({ id: 'c1', title: 'Unique Title', status: 'In-progress' }),
    makeCase({ id: 'c2', title: 'Another', status: 'Completed' }),
  ];
  el.connectedCallback();

  const filterInput = /** @type {any} */ (findFirst(el, 'input'));
  filterInput.value = 'completed';
  for (const h of filterInput._listeners['input'] ?? []) {
    h({ target: filterInput });
  }

  const rows = findAll(el, 'tr').filter(r => r.className === 'cr-case-row');
  assert.equal(rows.length, 1, 'should match one row by status');
  assert.equal(findAll(rows[0], 'a')[0]?.href, '#/case/c2');
});
