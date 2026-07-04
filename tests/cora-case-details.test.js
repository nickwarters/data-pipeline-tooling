// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

// DOM stubs must be in place before any src import

const { CORACaseDetails, CaseDetails, caseDetailFields } =
  await import('../src/components/cora-case-details.js');

/** @returns {import('../src/sharepoint-client.js').CaseRow} */
function makeCase(overrides = {}) {
  return {
    id: 'case-1',
    caseType: 'example-review',
    title: 'A test case',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    dueDate: '2026-06-30',
    relatedDate: '2026-05-01',
    created: '2026-04-01',
    etag: 'W/"1"',
    ...overrides,
  };
}

/**
 * Flattens the rendered tree's text into a single string for content assertions.
 * @param {any} el
 * @returns {string}
 */
function allText(el) {
  let out = el.textContent ? el.textContent + ' ' : '';
  for (const c of el._children) out += allText(c);
  return out;
}

/**
 * Collects all dt/dd-style label+value pairs as {label, value}.
 * @param {any} el
 * @returns {Record<string, string>}
 */
function fieldMap(el) {
  /** @type {Record<string, string>} */
  const map = {};
  const dl = el._children.find((/** @type {any} */ c) =>
    c._children.some((/** @type {any} */ g) => g._attrs?.['data-field'])
  );
  const target = dl ?? el;
  for (const child of target._children) {
    const field = child._attrs?.['data-field'];
    if (field) map[field] = child.textContent;
  }
  return map;
}

test('caseDetailFields: returns the labelled Case Details fields in order with em-dash fallback', () => {
  const fields = caseDetailFields(
    makeCase({ title: 'T', dueDate: null, completedAt: '2026-06-05' })
  );
  assert.deepEqual(
    fields.map((f) => f.field),
    [
      'title',
      'assignedReviewer',
      'status',
      'dueDate',
      'relatedDate',
      'created',
      'completedAt',
    ]
  );
  const byField = Object.fromEntries(fields.map((f) => [f.field, f.display]));
  assert.equal(byField.title, 'T');
  assert.equal(byField.dueDate, '—');
  assert.equal(byField.completedAt, '2026-06-05');
});

test('caseDetailFields: appends configured detail fields after the common fields with values from details', () => {
  const fields = caseDetailFields(
    makeCase({
      details: { customerName: 'Jordan Lee', accountNumber: 'ACC-4471' },
    }),
    [
      { key: 'customerName', label: 'Customer name' },
      { key: 'accountNumber', label: 'Account number' },
    ]
  );
  assert.deepEqual(
    fields.map((f) => f.field),
    [
      'title',
      'assignedReviewer',
      'status',
      'dueDate',
      'relatedDate',
      'created',
      'completedAt',
      'customerName',
      'accountNumber',
    ]
  );
  const byField = Object.fromEntries(fields.map((f) => [f.field, f.display]));
  assert.equal(byField.customerName, 'Jordan Lee');
  assert.equal(byField.accountNumber, 'ACC-4471');
});

test('caseDetailFields: configured field with no stored value falls back to an em dash', () => {
  const fields = caseDetailFields(makeCase({ details: {} }), [
    { key: 'customerName', label: 'Customer name' },
  ]);
  const byField = Object.fromEntries(fields.map((f) => [f.field, f.display]));
  assert.equal(byField.customerName, '—');
});

test('caseDetailFields: a Case Type without detail fields returns only the common fields', () => {
  const fields = caseDetailFields(makeCase());
  assert.equal(fields.length, 7);
});

test('CaseDetails: plain function renders no nodes without a case row', () => {
  assert.deepEqual(CaseDetails({ caseRow: null, access: 'read-only' }), []);
});

test('CaseDetails: plain function renders the Case row fields', () => {
  const nodes = CaseDetails({
    caseRow: makeCase({ title: 'Plain case' }),
    access: 'read-only',
  });
  const fields = fieldMap({ _children: nodes });

  assert.equal(fields.title, 'Plain case');
});

test('CORACaseDetails: renders configured detail field values for the current Case Type', () => {
  const el = new CORACaseDetails();
  el.caseRow = makeCase({
    details: { customerName: 'Jordan Lee', accountNumber: 'ACC-4471' },
  });
  el.detailFields = [
    { key: 'customerName', label: 'Customer name' },
    { key: 'accountNumber', label: 'Account number' },
  ];
  el.connectedCallback();
  const fields = fieldMap(/** @type {any} */ (el));
  assert.equal(fields.customerName, 'Jordan Lee');
  assert.equal(fields.accountNumber, 'ACC-4471');
});

test('CORACaseDetails: defaults to no configured detail fields', () => {
  const el = new CORACaseDetails();
  assert.deepEqual(el.detailFields, []);
});

test('CORACaseDetails: renders only the common fields when the Case Type declares no detail fields', () => {
  const el = new CORACaseDetails();
  el.caseRow = makeCase({ details: { customerName: 'ignored' } });
  el.connectedCallback();
  const fields = fieldMap(/** @type {any} */ (el));
  assert.equal(fields.customerName, undefined);
  assert.equal(fields.title, 'A test case');
});

test('CORACaseDetails: defaults to read-only access', () => {
  const el = new CORACaseDetails();
  assert.equal(el.access, 'read-only');
});

test('CORACaseDetails: renders Case Details heading', () => {
  const el = new CORACaseDetails();
  el.caseRow = makeCase();
  el.connectedCallback();
  const heading = /** @type {any} */ (el)._children[0];
  assert.equal(heading.textContent, 'Case Details');
});

test('CORACaseDetails: does nothing when caseRow is null', () => {
  const el = new CORACaseDetails();
  el.caseRow = null;
  el.connectedCallback();
  assert.equal(/** @type {any} */ (el)._children.length, 0);
});

test('CORACaseDetails: renders title from the Case row', () => {
  const el = new CORACaseDetails();
  el.caseRow = makeCase({ title: 'My case title' });
  el.connectedCallback();
  const fields = fieldMap(/** @type {any} */ (el));
  assert.equal(fields.title, 'My case title');
});

test('CORACaseDetails: renders assigned reviewer from the Case row', () => {
  const el = new CORACaseDetails();
  el.caseRow = makeCase({ assignedReviewer: 'jane.doe' });
  el.connectedCallback();
  const fields = fieldMap(/** @type {any} */ (el));
  assert.equal(fields.assignedReviewer, 'jane.doe');
});

test('CORACaseDetails: renders status from the Case row', () => {
  const el = new CORACaseDetails();
  el.caseRow = makeCase({ status: 'Completed' });
  el.connectedCallback();
  const fields = fieldMap(/** @type {any} */ (el));
  assert.equal(fields.status, 'Completed');
});

test('CORACaseDetails: renders date fields from the Case row', () => {
  const el = new CORACaseDetails();
  el.caseRow = makeCase({
    dueDate: '2026-06-30',
    relatedDate: '2026-05-01',
    created: '2026-04-01',
    completedAt: '2026-06-05',
  });
  el.connectedCallback();
  const fields = fieldMap(/** @type {any} */ (el));
  assert.equal(fields.dueDate, '2026-06-30');
  assert.equal(fields.relatedDate, '2026-05-01');
  assert.equal(fields.created, '2026-04-01');
  assert.equal(fields.completedAt, '2026-06-05');
});

test('CORACaseDetails: missing/null date fields render an em dash', () => {
  const el = new CORACaseDetails();
  el.caseRow = makeCase({
    dueDate: null,
    relatedDate: null,
    created: undefined,
    completedAt: null,
  });
  el.connectedCallback();
  const fields = fieldMap(/** @type {any} */ (el));
  assert.equal(fields.dueDate, '—');
  assert.equal(fields.relatedDate, '—');
  assert.equal(fields.created, '—');
  assert.equal(fields.completedAt, '—');
});

test('CORACaseDetails: read-only access sets a read-only marker and no form controls', () => {
  const el = new CORACaseDetails();
  el.caseRow = makeCase();
  el.access = 'read-only';
  el.connectedCallback();
  assert.equal(/** @type {any} */ (el)._attrs?.['data-access'], 'read-only');
  // Placeholder is read-only: it must not produce any input/textarea/button.
  function noControls(/** @type {any} */ node) {
    for (const c of node._children) {
      assert.equal(c._listeners['input'], undefined);
      assert.equal(c._listeners['click'], undefined);
      noControls(c);
    }
  }
  noControls(/** @type {any} */ (el));
});

test('CORACaseDetails: renders all values via textContent (no innerHTML)', () => {
  const el = new CORACaseDetails();
  el.caseRow = makeCase({ title: 'Safe <b>title</b>' });
  el.connectedCallback();
  // Value preserved verbatim as text, never parsed as HTML.
  const text = allText(/** @type {any} */ (el));
  assert.ok(text.includes('Safe <b>title</b>'));
});
