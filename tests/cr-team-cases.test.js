// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl, useElementClass, flush } from './_dom-stub.js';

installDom();

class ChildStubEl extends StubEl {
  constructor(tag = '') {
    super(tag);
    /** @type {any} */
    this.cases = null;
    /** @type {any} */
    this.toolbar = null;
    this.connectedCallbackCalled = false;
    /** @type {any} */
    this.client = null;
    /** @type {any} */
    this.currentUser = null;
    /** @type {string[]} */
    this.eligibleCaseTypes = [];
    this.queryString = '';
    this.currentUserId = '';
  }
  connectedCallback() {
    this.connectedCallbackCalled = true;
  }
}

useElementClass(ChildStubEl);

/** @type {string[]} */
const createdTags = [];

const { TeamCasesPage } = await import('../src/pages/cr-team-cases.js');

/** @param {any} node @param {string} text @returns {boolean} */
function hasText(node, text) {
  if (typeof node.textContent === 'string' && node.textContent === text)
    return true;
  for (const c of node._children ?? []) {
    if (hasText(c, text)) return true;
  }
  return false;
}

/** @param {any} node @param {string} tag @returns {any|null} */
function findTag(node, tag) {
  if (node.tagName === tag.toUpperCase()) return node;
  for (const c of node._children ?? []) {
    const f = findTag(c, tag);
    if (f) return f;
  }
  return null;
}

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @param {string} id @param {string} caseType @returns {CaseRow} */
const row = (id, caseType) => ({
  id,
  caseType,
  title: `Case ${id}`,
  status: 'In-progress',
  assignedReviewer: 'r',
  responsibleParty: 'rp',
  answers: {},
  conversation: [],
  notes: '',
  completedAt: null,
  etag: 'e',
});

test('cr-team-cases: renders heading', async () => {
  const host = TeamCasesPage({
    client: /** @type {any} */ ({
      async listCases() {
        return [];
      },
    }),
    currentUser: { id: 'u1', displayName: 'U' },
    eligibleCaseTypes: ['example-review'],
    queryString: '?manager=me&role=reviewer-manager',
  });

  await flush();
  assert.ok(hasText(host, 'Team Cases'), 'should render "Team Cases" heading');
});

test('cr-team-cases: renders empty state when no cases returned', async () => {
  const host = TeamCasesPage({
    client: /** @type {any} */ ({
      async listCases() {
        return [];
      },
    }),
    currentUser: { id: 'u1', displayName: 'U' },
    eligibleCaseTypes: ['example-review'],
    queryString: '?manager=me&role=reviewer-manager',
  });

  await flush();
  assert.ok(
    hasText(host, 'No cases match the selected filters.'),
    'should render empty-state message'
  );
  assert.ok(
    !findTag(host, 'cr-case-table'),
    'should not render cr-case-table when empty'
  );
});

test('cr-team-cases: renders cr-case-table with cases when results returned', async () => {
  const cases = [row('c1', 'example-review'), row('c2', 'example-review')];
  const host = TeamCasesPage({
    client: /** @type {any} */ ({
      async listCases() {
        return cases;
      },
    }),
    currentUser: { id: 'u1', displayName: 'U' },
    eligibleCaseTypes: ['example-review'],
    queryString: '?manager=me&role=reviewer-manager',
  });

  await flush();
  const table = findTag(host, 'cr-case-table');
  assert.ok(table, 'should render cr-case-table');
  assert.deepEqual(table.cases, cases, 'should pass cases to table');
  assert.strictEqual(table.toolbar, 'hidden', 'should hide toolbar');
});

test('cr-team-cases: passes query-string params to fetcher (caseType scoping)', async () => {
  /** @type {import('../src/sharepoint-client.js').ListCasesFilter[]} */
  const calls = [];
  const host = TeamCasesPage({
    client: /** @type {any} */ ({
      async listCases(/** @type {any} */ f) {
        calls.push(f);
        return [row('c1', 'example-review')];
      },
    }),
    currentUser: { id: 'u1', displayName: 'U' },
    eligibleCaseTypes: ['example-review', 'product-sale-review'],
    queryString: '?manager=me&role=reviewer-manager&caseType=example-review',
  });

  await flush();
  assert.equal(calls.length, 1, 'should query only the specified caseType');
  assert.equal(calls[0].caseType, 'example-review');
});

test('cr-team-cases: renders back link to #/reports', async () => {
  const host = TeamCasesPage({
    client: /** @type {any} */ ({
      async listCases() {
        return [];
      },
    }),
    currentUser: { id: 'u1', displayName: 'U' },
    eligibleCaseTypes: [],
    queryString: '',
  });

  await flush();
  const link = findTag(host, 'a');
  assert.ok(link, 'should render back link');
  assert.equal(link._attrs['href'], '#/reports');
});

test('cr-team-cases: renders heading and back link without fetching when client is null', async () => {
  const host = TeamCasesPage({
    client: null,
    currentUser: { id: 'u1', displayName: 'U' },
    eligibleCaseTypes: [],
    queryString: '',
  });

  await flush();
  assert.ok(hasText(host, 'Team Cases'), 'should still render heading');
  assert.ok(
    !findTag(host, 'cr-case-table'),
    'should not render table when no client'
  );
});

test('cr-team-cases: renders heading and back link without fetching when currentUser is null', async () => {
  const host = TeamCasesPage({
    client: /** @type {any} */ ({
      async listCases() {
        return [];
      },
    }),
    currentUser: null,
    eligibleCaseTypes: [],
    queryString: '',
  });

  await flush();
  assert.ok(hasText(host, 'Team Cases'), 'should still render heading');
  assert.ok(
    !findTag(host, 'cr-case-table'),
    'should not render table when no currentUser'
  );
});
