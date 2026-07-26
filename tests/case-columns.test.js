// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const {
  caseReferenceColumn,
  caseTypeColumn,
  caseStatusColumn,
  caseActionsColumn,
  standardCaseColumns,
} = await import('../src/views/case-columns.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

/** @param {Partial<CaseRow>} [overrides] @returns {CaseRow} */
function row(overrides = {}) {
  return /** @type {any} */ ({
    id: 'c1',
    caseType: 'complaints',
    title: 'Case c1',
    status: 'In-progress',
    assignedReviewer: 'r',
    responsibleParty: 'rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'e',
    dueDate: '2026-01-10',
    created: 'reviewer-a',
    ...overrides,
  });
}

test('the Reference column links to the Case and falls back to the id', () => {
  const column = caseReferenceColumn();
  assert.equal(column.key, 'reference');
  assert.equal(column.label, 'Reference');
  assert.equal(column.sortable, true);
  assert.equal(
    /** @type {(row: CaseRow) => unknown} */ (column.value)(row()),
    'Case c1'
  );
  assert.equal(
    /** @type {(row: CaseRow) => unknown} */ (column.value)(row({ title: '' })),
    'c1'
  );
  assert.equal(column.href?.(row()), '#/case/complaints/c1');
});

test('the Case Type and Status columns select by property path', () => {
  assert.deepEqual(caseTypeColumn(), {
    key: 'caseType',
    label: 'Case Type',
    value: 'caseType',
    sortable: true,
  });
  assert.deepEqual(caseStatusColumn(), {
    key: 'status',
    label: 'Status',
    value: 'status',
    sortable: true,
  });
});

test('the Actions column renders an Open button that calls the injected opener', () => {
  /** @type {CaseRow[]} */
  const opened = [];
  const column = caseActionsColumn((row) => opened.push(row));
  assert.equal(column.key, 'actions');
  assert.equal(column.label, 'Actions');
  assert.equal(column.sortable, undefined);
  assert.equal(column.href, undefined);

  const subject = row();
  const value = /** @type {(row: CaseRow) => unknown} */ (column.value)(
    subject
  );
  assert.equal(value, 'Case c1');
  const button = /** @type {any} */ (column.format?.(value, subject));
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.getAttribute('type'), 'button');
  assert.equal(button.className, 'cora-case-open-btn');
  assert.equal(button.getAttribute('aria-label'), 'Open Case c1');
  assert.equal(button.textContent, 'Open');
  button.dispatchEvent({ type: 'click' });
  assert.deepEqual(opened, [subject]);
});

test('the standard Case table is the seven columns in their established order', () => {
  const columns = standardCaseColumns({ onOpen: () => {} });
  assert.deepEqual(
    columns.map((column) => column.key),
    [
      'reference',
      'caseType',
      'relatedDate',
      'dueDate',
      'status',
      'assigned',
      'actions',
    ]
  );
  assert.deepEqual(
    columns.map((column) => column.label),
    [
      'Reference',
      'Case Type',
      'Related Date',
      'Due Date',
      'Status',
      'Assigned',
      'Actions',
    ]
  );
  assert.equal(columns.filter((column) => column.sortable).length, 6);
});

test('the standard date and assigned columns keep their empty-string sort value', () => {
  const columns = standardCaseColumns({ onOpen: () => {} });
  /** @param {string} key @param {CaseRow} subject */
  const valueOf = (key, subject) => {
    const column = columns.find((candidate) => candidate.key === key);
    assert.ok(column, `no ${key} column`);
    assert.equal(typeof column.value, 'function');
    return /** @type {(row: CaseRow) => unknown} */ (column.value)(subject);
  };

  const blank = row({ dueDate: undefined, created: undefined });
  const populated = row();
  /** @type {any} */ (populated).relatedDate = '2026-01-01';
  const keys = ['relatedDate', 'dueDate', 'assigned'];

  assert.deepEqual(
    keys.map((key) => valueOf(key, blank)),
    ['', '', '']
  );
  assert.deepEqual(
    keys.map((key) => valueOf(key, populated)),
    ['2026-01-01', '2026-01-10', 'reviewer-a']
  );
});

test('extra columns append after the standard seven', () => {
  const columns = standardCaseColumns({
    onOpen: () => {},
    extra: [{ key: 'owner', label: 'Owner', value: 'responsibleParty' }],
  });
  assert.deepEqual(columns.at(-1), {
    key: 'owner',
    label: 'Owner',
    value: 'responsibleParty',
  });
  assert.equal(columns.length, 8);
});
