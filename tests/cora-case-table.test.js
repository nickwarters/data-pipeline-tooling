// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  queryAllByRole,
  queryAllByTag,
  queryByTag,
} from './helpers/semantic-dom.js';

installDom();

// ===== IMPORTS (after stubs) =====
const { CORACaseTable } =
  await import('../src/components/collections/cora-case-table.js');

// ===== HELPERS =====
/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

/** @returns {CaseRow} */
function makeCase(overrides = {}) {
  return {
    id: 'case-1',
    caseType: 'example-review',
    title: 'Example Review #1',
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

test('CORACaseTable: connectedCallback renders a table element', () => {
  const el = new CORACaseTable();
  el.cases = [makeCase()];
  el.connectedCallback();
  const tables = queryAllByTag(el, 'table');
  assert.equal(tables.length, 1, 'should render one table');
});

test('CORACaseTable: renders header row with expected column labels', () => {
  const el = new CORACaseTable();
  el.cases = [];
  el.connectedCallback();
  const buttons = queryAllByTag(el, 'button').filter(
    (b) => b.className !== 'cora-case-open-btn'
  );
  const labels = buttons.map((b) => b.textContent);
  assert.ok(labels.includes('Reference'), 'should have Reference column');
  assert.ok(labels.includes('Case Type'), 'should have Case Type column');
  assert.ok(labels.includes('Due Date'), 'should have Due Date column');
  assert.ok(labels.includes('Status'), 'should have Status column');
});

test('CORACaseTable: renders one row per case', () => {
  const el = new CORACaseTable();
  el.cases = [
    makeCase({ id: 'c1', title: 'Case A' }),
    makeCase({ id: 'c2', title: 'Case B' }),
    makeCase({ id: 'c3', title: 'Case C' }),
  ];
  el.connectedCallback();
  const rows = queryAllByTag(el, 'tr').filter(
    (r) => r.className === 'cora-case-row'
  );
  assert.equal(rows.length, 3, 'should render three case rows');
});

test('CORACaseTable: row contains a link to the case', () => {
  const el = new CORACaseTable();
  el.cases = [makeCase({ id: 'case-42', title: 'Test Case' })];
  el.connectedCallback();
  const links = queryAllByTag(el, 'a');
  assert.equal(links.length, 1, 'should render one link');
  assert.equal(
    links[0].href,
    '#/case/example-review/case-42',
    'link should point to case route'
  );
});

test('CORACaseTable: free-text filter hides non-matching rows', () => {
  const el = new CORACaseTable();
  el.cases = [
    makeCase({ id: 'c1', title: 'Alpha Review', caseType: 'example-review' }),
    makeCase({ id: 'c2', title: 'Beta Review', caseType: 'goodbye-review' }),
  ];
  el.connectedCallback();

  // Simulate filter input event
  const filterInput = /** @type {any} */ (queryByTag(el, 'input'));
  assert.ok(filterInput, 'should have filter input');
  filterInput.value = 'alpha';
  fireEvent(filterInput, 'input');

  const rows = queryAllByTag(el, 'tr').filter(
    (r) => r.className === 'cora-case-row'
  );
  assert.equal(rows.length, 1, 'only the matching row should be visible');
  assert.equal(
    queryAllByTag(rows[0], 'a')[0]?.href,
    '#/case/example-review/c1'
  );
});

test('CORACaseTable: free-text filter matches case type', () => {
  const el = new CORACaseTable();
  el.cases = [
    makeCase({ id: 'c1', title: 'Case One', caseType: 'example-review' }),
    makeCase({ id: 'c2', title: 'Case Two', caseType: 'goodbye-review' }),
  ];
  el.connectedCallback();

  const filterInput = /** @type {any} */ (queryByTag(el, 'input'));
  filterInput.value = 'goodbye';
  fireEvent(filterInput, 'input');

  const rows = queryAllByTag(el, 'tr').filter(
    (r) => r.className === 'cora-case-row'
  );
  assert.equal(rows.length, 1, 'should match by case type');
  assert.equal(
    queryAllByTag(rows[0], 'a')[0]?.href,
    '#/case/goodbye-review/c2'
  );
});

test('CORACaseTable: status filter shows only matching rows', () => {
  const el = new CORACaseTable();
  el.cases = [
    makeCase({ id: 'c1', status: 'In-progress' }),
    makeCase({ id: 'c2', status: 'Completed' }),
    makeCase({ id: 'c3', status: 'In-progress' }),
  ];
  el.connectedCallback();

  const statusSelect = /** @type {any} */ (queryByTag(el, 'select'));
  assert.ok(statusSelect, 'should have status filter select');
  statusSelect.value = 'Completed';
  fireEvent(statusSelect, 'change');

  const rows = queryAllByTag(el, 'tr').filter(
    (r) => r.className === 'cora-case-row'
  );
  assert.equal(rows.length, 1, 'only completed cases should be visible');
  assert.equal(
    queryAllByTag(rows[0], 'a')[0]?.href,
    '#/case/example-review/c2'
  );
});

test('CORACaseTable: status filter cleared shows all rows', () => {
  const el = new CORACaseTable();
  el.cases = [
    makeCase({ id: 'c1', status: 'In-progress' }),
    makeCase({ id: 'c2', status: 'Completed' }),
  ];
  el.connectedCallback();

  const statusSelect = /** @type {any} */ (queryByTag(el, 'select'));
  // Apply filter
  statusSelect.value = 'Completed';
  fireEvent(statusSelect, 'change');
  // Clear filter
  statusSelect.value = '';
  fireEvent(statusSelect, 'change');

  const rows = queryAllByTag(el, 'tr').filter(
    (r) => r.className === 'cora-case-row'
  );
  assert.equal(
    rows.length,
    2,
    'all rows should be visible after clearing filter'
  );
});

test('CORACaseTable: sorting by Reference column sorts rows alphabetically', () => {
  const el = new CORACaseTable();
  el.cases = [
    makeCase({ id: 'c1', title: 'Zebra Case' }),
    makeCase({ id: 'c2', title: 'Alpha Case' }),
    makeCase({ id: 'c3', title: 'Mango Case' }),
  ];
  el.connectedCallback();

  // Click the Reference sort button
  const headerBtns = queryAllByTag(el, 'button').filter(
    (b) => b.textContent === 'Reference'
  );
  assert.equal(headerBtns.length, 1, 'should have Reference sort button');
  fireEvent(headerBtns[0], 'click');

  const rows = queryAllByTag(el, 'tr').filter(
    (r) => r.className === 'cora-case-row'
  );
  const links = rows.map((r) => queryAllByTag(r, 'a')[0]?.textContent);
  assert.deepEqual(
    links,
    ['Alpha Case', 'Mango Case', 'Zebra Case'],
    'rows should be sorted asc by reference'
  );
});

test('CORACaseTable: second click on same column reverses sort direction', () => {
  const el = new CORACaseTable();
  el.cases = [
    makeCase({ id: 'c1', title: 'Zebra Case' }),
    makeCase({ id: 'c2', title: 'Alpha Case' }),
  ];
  el.connectedCallback();

  const refBtn = queryAllByTag(el, 'button').find(
    (b) => b.textContent === 'Reference'
  );
  assert.ok(refBtn);

  // First click: asc
  fireEvent(refBtn, 'click');
  // Second click: desc
  fireEvent(refBtn, 'click');

  const rows = queryAllByTag(el, 'tr').filter(
    (r) => r.className === 'cora-case-row'
  );
  const links = rows.map((r) => queryAllByTag(r, 'a')[0]?.textContent);
  assert.deepEqual(
    links,
    ['Zebra Case', 'Alpha Case'],
    'rows should be sorted desc after second click'
  );
});

test('CORACaseTable: clicking a different column resets sort to asc', () => {
  const el = new CORACaseTable();
  el.cases = [
    makeCase({
      id: 'c1',
      title: 'B Case',
      status: 'In-progress',
      caseType: 'zzz-review',
    }),
    makeCase({
      id: 'c2',
      title: 'A Case',
      status: 'Completed',
      caseType: 'aaa-review',
    }),
  ];
  el.connectedCallback();

  // Sort by Reference descending
  const refBtn = queryAllByTag(el, 'button').find(
    (b) => b.textContent === 'Reference'
  );
  assert.ok(refBtn);
  fireEvent(refBtn, 'click'); // asc
  fireEvent(refBtn, 'click'); // desc

  // Switch to Case Type sort
  const typeBtn = queryAllByTag(el, 'button').find(
    (b) => b.textContent === 'Case Type'
  );
  assert.ok(typeBtn);
  fireEvent(typeBtn, 'click');

  const rows = queryAllByTag(el, 'tr').filter(
    (r) => r.className === 'cora-case-row'
  );
  const links = rows.map((r) => queryAllByTag(r, 'a')[0]?.textContent);
  assert.deepEqual(
    links,
    ['A Case', 'B Case'],
    'switching columns should reset to asc'
  );
});

test('CORACaseTable: aria-sort reflects current sort column and direction', () => {
  const el = new CORACaseTable();
  el.cases = [makeCase()];
  el.connectedCallback();

  // Initial state: reference column sorted asc (default)
  assert.ok(queryByTag(el, 'thead'), 'should have a table head');

  // Click Reference to sort asc
  const refBtn = queryAllByTag(el, 'button').find(
    (b) => b.textContent === 'Reference'
  );
  assert.ok(refBtn);
  fireEvent(refBtn, 'click');

  // Find the Reference th (first th with cora-col-reference class)
  const allTh = queryAllByTag(el, 'th');
  const refTh = allTh.find((th) => th.className === 'cora-col-reference');
  assert.ok(refTh, 'should find Reference th');
  assert.equal(
    refTh.getAttribute('aria-sort'),
    'ascending',
    'active column should be ascending'
  );

  // Other columns should be none
  const statusTh = allTh.find((th) => th.className === 'cora-col-status');
  assert.ok(statusTh);
  assert.equal(
    statusTh.getAttribute('aria-sort'),
    'none',
    'inactive column should be none'
  );

  // Click again: desc
  const refBtn2 = queryAllByTag(el, 'button').find(
    (b) => b.textContent === 'Reference'
  );
  assert.ok(refBtn2);
  fireEvent(refBtn2, 'click');

  const refTh2 = queryAllByTag(el, 'th').find(
    (th) => th.className === 'cora-col-reference'
  );
  assert.ok(refTh2);
  assert.equal(
    refTh2.getAttribute('aria-sort'),
    'descending',
    'should be descending after second click'
  );
});

test('CORACaseTable: dispatches cora-case-open event when Open button is clicked', () => {
  const el = new CORACaseTable();
  el.cases = [makeCase({ id: 'case-99' })];
  el.connectedCallback();

  /** @type {any[]} */
  const dispatched = [];
  el.addEventListener('cora-case-open', (e) => dispatched.push(e));

  const openBtns = queryAllByTag(el, 'button').filter(
    (b) => b.className === 'cora-case-open-btn'
  );
  assert.equal(openBtns.length, 1, 'should have one Open button');
  fireEvent(openBtns[0], 'click');

  assert.equal(dispatched.length, 1, 'should dispatch cora-case-open once');
  assert.equal(dispatched[0].detail.caseId, 'case-99');
});

test('CORACaseTable: dispatches cora-case-open when Enter pressed on a row', () => {
  const el = new CORACaseTable();
  el.cases = [makeCase({ id: 'case-77' })];
  el.connectedCallback();

  /** @type {any[]} */
  const dispatched = [];
  el.addEventListener('cora-case-open', (e) => dispatched.push(e));

  const rows = queryAllByTag(el, 'tr').filter(
    (r) => r.className === 'cora-case-row'
  );
  assert.equal(rows.length, 1);
  fireEvent(rows[0], 'keydown', { key: 'Enter' });

  assert.equal(dispatched.length, 1, 'should dispatch cora-case-open on Enter');
  assert.equal(dispatched[0].detail.caseId, 'case-77');
});

test('CORACaseTable: setting cases after connectedCallback re-renders rows', () => {
  const el = new CORACaseTable();
  el.cases = [];
  el.connectedCallback();

  let rows = queryAllByTag(el, 'tr').filter(
    (r) => r.className === 'cora-case-row'
  );
  assert.equal(rows.length, 0, 'initially empty');

  el.cases = [makeCase({ id: 'c1' }), makeCase({ id: 'c2' })];

  rows = queryAllByTag(el, 'tr').filter((r) => r.className === 'cora-case-row');
  assert.equal(rows.length, 2, 'should re-render when cases are updated');
});

test('CORACaseTable: filter input has aria-label', () => {
  const el = new CORACaseTable();
  el.cases = [];
  el.connectedCallback();
  const input = queryByTag(el, 'input');
  assert.ok(input, 'should have input');
  assert.equal(
    input.getAttribute('aria-label'),
    'Filter cases',
    'filter input needs aria-label'
  );
});

test('CORACaseTable: status select has aria-label', () => {
  const el = new CORACaseTable();
  el.cases = [];
  el.connectedCallback();
  const select = queryByTag(el, 'select');
  assert.ok(select, 'should have select');
  assert.equal(
    select.getAttribute('aria-label'),
    'Filter by status',
    'select needs aria-label'
  );
});

test('CORACaseTable: filtering does not replace the host subtree (keeps input focus + inner reactivity)', () => {
  const el = new CORACaseTable();
  el.cases = [
    makeCase({ id: 'c1', title: 'Alpha' }),
    makeCase({ id: 'c2', title: 'Beta' }),
  ];

  // Count how many times the shell replaces the host's children. A re-render on
  // every keystroke would, in a real browser, disconnect/reconnect the inner
  // <cora-data-table> (killing its reactivity) and blur the filter input. The
  // shell must render its structure once and thereafter only feed rows.
  let hostReplaceCount = 0;
  const originalReplace = el.replaceChildren.bind(el);
  el.replaceChildren = (/** @type {any[]} */ ...cs) => {
    hostReplaceCount++;
    return originalReplace(...cs);
  };

  el.connectedCallback();
  const afterConnect = hostReplaceCount;
  const inputBefore = queryByTag(el, 'input');

  // Simulate typing into the filter.
  const filterInput = /** @type {any} */ (queryByTag(el, 'input'));
  filterInput.value = 'beta';
  fireEvent(filterInput, 'input');

  assert.equal(
    hostReplaceCount,
    afterConnect,
    'filtering must not replace the host children (no shell re-render)'
  );
  assert.equal(
    queryByTag(el, 'input'),
    inputBefore,
    'the filter input node must survive filtering unchanged'
  );

  // …and the inner table must still react to the filter.
  const rows = queryAllByTag(el, 'tr').filter(
    (r) => r.className === 'cora-case-row'
  );
  assert.equal(rows.length, 1, 'only the matching row should remain');
  assert.equal(queryAllByTag(rows[0], 'a')[0]?.textContent, 'Beta');
});

test('CORACaseTable: custom columns override defaults', () => {
  const el = new CORACaseTable();
  /** @type {any} */ (el).columns = [
    {
      key: 'reference',
      label: 'Ref',
      getValue: (/** @type {any} */ r) => r.title,
    },
    {
      key: 'caseType',
      label: 'Type',
      getValue: (/** @type {any} */ r) => r.caseType,
    },
  ];
  el.cases = [makeCase({ id: 'c1', title: 'My Case', caseType: 'audit' })];
  el.connectedCallback();
  const ths = queryAllByTag(el, 'th');
  assert.equal(ths.length, 2, 'should render only the two custom columns');
  const rows = queryAllByTag(el, 'tr');
  // 1 header row + 1 data row
  assert.equal(rows.length, 2);
});

test('CORACaseTable: rowClass is applied to data rows', () => {
  const el = new CORACaseTable();
  /** @type {any} */ (el).columns = [
    {
      key: 'reference',
      label: 'Ref',
      getValue: (/** @type {any} */ r) => r.title,
    },
  ];
  /** @type {any} */ (el).rowClass = (/** @type {any} */ r) =>
    r.id === 'flag' ? 'cora-flagged' : '';
  el.cases = [
    makeCase({ id: 'flag', title: 'Flagged' }),
    makeCase({ id: 'ok', title: 'Normal' }),
  ];
  el.connectedCallback();
  const dataRows = queryAllByTag(el, 'tr').filter(
    (row) => queryAllByRole(row, 'cell').length > 0
  );
  assert.equal(dataRows.length, 2);
  assert.equal(dataRows[0].className, 'cora-flagged');
  assert.equal(dataRows[1].className, '');
});

test('CORACaseTable: hidden toolbar omits filter input and status select', () => {
  const el = new CORACaseTable();
  /** @type {any} */ (el).toolbar = 'hidden';
  /** @type {any} */ (el).columns = [
    {
      key: 'reference',
      label: 'Ref',
      getValue: (/** @type {any} */ r) => r.title,
    },
  ];
  el.cases = [makeCase()];
  el.connectedCallback();
  assert.equal(queryByTag(el, 'input'), null, 'no filter input when hidden');
  assert.equal(queryByTag(el, 'select'), null, 'no status select when hidden');
});

test('CORACaseTable: initial sort prop drives default order', () => {
  const el = new CORACaseTable();
  /** @type {any} */ (el).columns = [
    {
      key: 'reference',
      label: 'Ref',
      sortable: true,
      getValue: (/** @type {any} */ r) => r.title,
    },
  ];
  /** @type {any} */ (el).sort = { key: 'reference', dir: 'desc' };
  el.cases = [
    makeCase({ id: 'a', title: 'Alpha' }),
    makeCase({ id: 'b', title: 'Beta' }),
    makeCase({ id: 'c', title: 'Gamma' }),
  ];
  el.connectedCallback();
  const dataRows = queryAllByTag(el, 'tr').filter(
    (row) => queryAllByRole(row, 'cell').length > 0
  );
  const titles = dataRows.map(
    (row) => queryAllByRole(row, 'cell')[0].textContent
  );
  assert.deepEqual(titles, ['Gamma', 'Beta', 'Alpha']);
});

test('CORACaseTable: case with empty title falls back to id in Open button aria-label', () => {
  const el = new CORACaseTable();
  el.cases = [makeCase({ id: 'case-no-title', title: '' })];
  el.connectedCallback();
  const openBtn = queryAllByTag(el, 'button').find(
    (b) => b.className === 'cora-case-open-btn'
  );
  assert.ok(openBtn, 'should have open button');
  assert.equal(openBtn.getAttribute('aria-label'), 'Open case-no-title');
});

test('CORACaseTable: free-text filter matches by status field', () => {
  const el = new CORACaseTable();
  el.cases = [
    makeCase({ id: 'c1', title: 'Unique Title', status: 'In-progress' }),
    makeCase({ id: 'c2', title: 'Another', status: 'Completed' }),
  ];
  el.connectedCallback();

  const filterInput = /** @type {any} */ (queryByTag(el, 'input'));
  filterInput.value = 'completed';
  fireEvent(filterInput, 'input');

  const rows = queryAllByTag(el, 'tr').filter(
    (r) => r.className === 'cora-case-row'
  );
  assert.equal(rows.length, 1, 'should match one row by status');
  assert.equal(
    queryAllByTag(rows[0], 'a')[0]?.href,
    '#/case/example-review/c2'
  );
});

// --- overdue indicator ---

test('CORACaseTable: default rowClass adds cora-case-row--overdue for overdue rows', () => {
  const el = new CORACaseTable();
  el.cases = [
    makeCase({ id: 'c1', overdue: true }),
    makeCase({ id: 'c2', overdue: false }),
    makeCase({ id: 'c3' }), // no overdue field
  ];
  el.connectedCallback();

  const rows = queryAllByTag(el, 'tr');
  const overdueRow = rows.find((r) =>
    r.className.includes('cora-case-row--overdue')
  );
  assert.ok(overdueRow, 'should have a row with cora-case-row--overdue class');

  const nonOverdueRows = rows.filter(
    (r) =>
      !r.className.includes('cora-case-row--overdue') &&
      r.className.includes('cora-case-row')
  );
  assert.equal(
    nonOverdueRows.length,
    2,
    'non-overdue rows should not have the overdue class'
  );
});
