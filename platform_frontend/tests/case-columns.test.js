// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { makeCaseRow } from './helpers/fixtures.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const {
  caseReferenceColumn,
  caseTypeColumn,
  caseStatusColumn,
  caseActionsColumn,
  caseFlagsColumn,
  standardCaseColumns,
} = await import('../src/views/case-columns.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

/** @param {Partial<CaseRow>} [overrides] @returns {CaseRow} */
function row(overrides = {}) {
  return makeCaseRow({
    id: 'c1',
    title: 'Case c1',
    assignedReviewer: 'r',
    responsibleParty: 'rp',
    etag: 'e',
    dueDate: '2026-01-10',
    created: '2026-01-02',
    assignedAt: '2026-01-05',
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

test('the Actions column takes an accessible name for openers that are not the Case', () => {
  const column = caseActionsColumn(() => {}, {
    openLabel: (value) => `Open conversation for ${value}`,
  });
  const subject = row();
  const value = /** @type {(row: CaseRow) => unknown} */ (column.value)(
    subject
  );
  const button = /** @type {any} */ (column.format?.(value, subject));
  assert.equal(
    button.getAttribute('aria-label'),
    'Open conversation for Case c1'
  );
  assert.equal(button.textContent, 'Open');
});

test('the Flags column marks an On Hold Case and a Case with Messages', () => {
  const column = caseFlagsColumn();
  assert.equal(column.key, 'flags');
  assert.equal(column.label, 'Flags');
  // Unsortable: a two-value key would only scramble whatever order the reader
  // had chosen.
  assert.equal(column.sortable, undefined);
  assert.equal(column.href, undefined);

  /** @param {Partial<CaseRow>} overrides */
  const marksFor = (overrides) => {
    const subject = row(overrides);
    const value = /** @type {(row: CaseRow) => unknown} */ (column.value)(
      subject
    );
    const cell = /** @type {any} */ (column.format?.(value, subject));
    return {
      value,
      labels: cell
        ? [...cell.querySelectorAll('svg')].map((/** @type {any} */ icon) =>
            icon.getAttribute('aria-label')
          )
        : null,
    };
  };

  // A Case raising neither flag leaves the cell empty. A dash would read as a
  // value the Case has.
  assert.deepEqual(marksFor({ onHold: false, conversation: [] }), {
    value: '',
    labels: null,
  });
  assert.deepEqual(marksFor({ onHold: true, conversation: [] }), {
    value: 'hold',
    labels: ['On hold'],
  });
  assert.deepEqual(
    marksFor({ onHold: false, conversation: [/** @type {any} */ ({})] }),
    { value: 'messages', labels: ['1 message'] }
  );
  // Both, in a fixed order, with the Message count in the accessible name.
  assert.deepEqual(
    marksFor({
      onHold: true,
      conversation: [/** @type {any} */ ({}), /** @type {any} */ ({})],
    }),
    { value: 'hold messages', labels: ['On hold', '2 messages'] }
  );
});

test('the Flags column survives a Case row carrying no Conversation at all', () => {
  const column = caseFlagsColumn();
  const subject = row();
  /** @type {any} */ (subject).conversation = undefined;
  assert.equal(
    /** @type {(row: CaseRow) => unknown} */ (column.value)(subject),
    ''
  );
  assert.equal(column.format?.('', subject), null);
});

test('the standard Case table is the nine columns in their established order', () => {
  const columns = standardCaseColumns({ onOpen: () => {} });
  assert.deepEqual(
    columns.map((column) => column.key),
    [
      'reference',
      'flags',
      'caseType',
      'relatedDate',
      'dueDate',
      'status',
      'assigned',
      'responsibleParty',
      'actions',
    ]
  );
  assert.deepEqual(
    columns.map((column) => column.label),
    [
      'Reference',
      'Flags',
      'Case Type',
      'Related Date',
      'Due Date',
      'Status',
      'Assigned',
      'Responsible Party',
      'Actions',
    ]
  );
  assert.equal(columns.filter((column) => column.sortable).length, 7);
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

  const blank = row({ dueDate: undefined, assignedAt: undefined });
  const populated = row();
  /** @type {any} */ (populated).relatedDate = '2026-01-01';
  const keys = ['relatedDate', 'dueDate', 'assigned'];

  assert.deepEqual(
    keys.map((key) => valueOf(key, blank)),
    ['', '', '']
  );
  assert.deepEqual(
    keys.map((key) => valueOf(key, populated)),
    ['2026-01-01', '2026-01-10', '2026-01-05']
  );
});

test('the Assigned column is the assignment time, never the creation date', () => {
  const assigned = standardCaseColumns({ onOpen: () => {} }).find(
    (candidate) => candidate.key === 'assigned'
  );
  assert.ok(assigned, 'no Assigned column');
  const value = /** @type {(row: CaseRow) => unknown} */ (assigned.value);

  // The two dates differ, so reading the wrong one is visible rather than
  // coincidentally right.
  assert.equal(
    value(row({ created: '2026-01-02', assignedAt: '2026-03-09' })),
    '2026-03-09'
  );
  // A Case nobody has been assigned shows nothing — the creation date must not
  // stand in for an assignment that has not happened.
  assert.equal(value(row({ created: '2026-01-02', assignedAt: null })), '');
});

test('Responsible Party is a framework column, read off the Case row', () => {
  const column = standardCaseColumns({ onOpen: () => {} }).find(
    (candidate) => candidate.key === 'responsibleParty'
  );
  assert.ok(column, 'no Responsible Party column');
  assert.equal(column.label, 'Responsible Party');
  assert.equal(column.value, 'responsibleParty');
  assert.equal(column.sortable, true);
});

test('callers cannot extend the standard set', () => {
  // The column set used to take an `extra` array that a Case Type's config fed.
  // Nothing may append to it now, so a caller still passing one is ignored
  // rather than quietly widening one page's table.
  const columns = standardCaseColumns(
    /** @type {any} */ ({
      onOpen: () => {},
      extra: [{ key: 'owner', label: 'Owner', value: 'responsibleParty' }],
    })
  );
  assert.equal(
    columns.some((column) => column.key === 'owner'),
    false
  );
  assert.equal(columns.at(-1)?.key, 'actions');
});
