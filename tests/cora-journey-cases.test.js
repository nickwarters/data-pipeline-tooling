// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  installDom,
  StubEl,
  useElementClass,
  waitForRender,
} from './_dom-stub.js';

installDom();

class ChildStubEl extends StubEl {
  constructor(tag = '') {
    super(tag);
    /** @type {any} */
    this.cases = null;
    /** @type {any} */
    this.toolbar = null;
    /** @type {any} */
    this.columns = null;
    /** @type {any} */
    this.client = null;
    /** @type {import('../src/setup/resolve-eligible-case-types.js').CaseSource[]} */
    this.journeyCaseSources = [];
  }
  connectedCallback() {}
}

useElementClass(ChildStubEl);

const { JourneyCasesPage } = await import('../src/pages/cora-journey-cases.js');

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
  status: 'Completed',
  assignedReviewer: 'r',
  responsibleParty: 'rp',
  answers: {},
  conversation: [],
  notes: '',
  completedAt: null,
  etag: 'e',
});

/**
 * @param {string} slug
 * @param {string} [listName]
 * @returns {import('../src/setup/resolve-eligible-case-types.js').CaseSource}
 */
const src = (slug, listName = `${slug}-list`) => ({
  slug,
  listName,
  displayName: slug,
});

test('cora-journey-cases: renders heading', async () => {
  const host = JourneyCasesPage({
    client: /** @type {any} */ ({
      async listCases() {
        return [];
      },
    }),
    journeyCaseSources: ['complaints'].map((s) => src(s)),
  });

  await waitForRender(host);
  assert.ok(hasText(host, 'Journey Cases'), 'should render heading');
});

test('cora-journey-cases: renders empty state when no cases', async () => {
  const host = JourneyCasesPage({
    client: /** @type {any} */ ({
      async listCases() {
        return [];
      },
    }),
    journeyCaseSources: ['complaints'].map((s) => src(s)),
  });

  await waitForRender(host);
  assert.ok(
    hasText(host, 'No cases of your Case Type(s) yet.'),
    'should render empty-state message'
  );
  assert.ok(
    !findTag(host, 'cora-case-table'),
    'should not render table when empty'
  );
});

test('cora-journey-cases: fans out across owned Case Types and lists cases', async () => {
  /** @type {import('../src/sharepoint-client.js').ListCasesFilter[]} */
  const calls = [];
  const cases = [row('c1', 'complaints'), row('c2', 'example-review')];
  const host = JourneyCasesPage({
    client: /** @type {any} */ ({
      async listCases(/** @type {any} */ f) {
        calls.push(f);
        return cases.filter((c) => c.caseType === f.caseType);
      },
    }),
    journeyCaseSources: ['complaints', 'example-review'].map((s) => src(s)),
  });

  await waitForRender(host);
  assert.equal(calls.length, 2, 'one bounded query per owned Case Type');
  const table = findTag(host, 'cora-case-table');
  assert.ok(table, 'should render cora-case-table');
  assert.equal(table.cases.length, 2);
  assert.strictEqual(table.toolbar, 'hidden', 'should hide toolbar');
});

test('cora-journey-cases: passes an explicit { listName } for every listCases call', async () => {
  /** @type {import('../src/sharepoint-client.js').CaseListOptions[]} */
  const opts = [];
  const host = JourneyCasesPage({
    client: /** @type {any} */ ({
      async listCases(/** @type {any} */ f, /** @type {any} */ o) {
        opts.push(o);
        return [];
      },
    }),
    journeyCaseSources: [
      src('complaints', 'Complaints'),
      src('example-review', 'ExampleReviews'),
    ],
  });

  await waitForRender(host);
  assert.equal(opts.length, 2);
  assert.ok(opts.some((o) => o.listName === 'Complaints'));
  assert.ok(opts.some((o) => o.listName === 'ExampleReviews'));
});

test('cora-journey-cases: columns expose reference/caseType/status and Summary link', async () => {
  const host = JourneyCasesPage({
    client: /** @type {any} */ ({
      async listCases() {
        return [row('c1', 'complaints')];
      },
    }),
    journeyCaseSources: ['complaints'].map((s) => src(s)),
  });

  await waitForRender(host);
  const table = findTag(host, 'cora-case-table');
  /** @param {string} key */
  const col = (key) =>
    table.columns.find((/** @type {any} */ c) => c.key === key);

  const r = row('c1', 'complaints');
  assert.equal(col('reference').getValue(r), 'Case c1');
  assert.equal(col('caseType').getValue(r), 'complaints');
  assert.equal(col('status').getValue(r), 'Completed');

  const link = col('reference').renderCell(r);
  assert.equal(link.tagName, 'A');
  assert.equal(link._attrs['href'], '#/case/complaints/c1');
});

test('cora-journey-cases: Reference falls back to id when title is empty', async () => {
  const host = JourneyCasesPage({
    client: /** @type {any} */ ({
      async listCases() {
        return [{ ...row('c9', 'complaints'), title: '' }];
      },
    }),
    journeyCaseSources: ['complaints'].map((s) => src(s)),
  });

  await waitForRender(host);
  const table = findTag(host, 'cora-case-table');
  const refCol = table.columns.find(
    (/** @type {any} */ c) => c.key === 'reference'
  );
  const r = { ...row('c9', 'complaints'), title: '' };
  assert.equal(refCol.getValue(r), 'c9');
  assert.equal(refCol.renderCell(r)._attrs['href'], '#/case/complaints/c9');
});

test('cora-journey-cases: renders heading without fetching when client is null', async () => {
  const host = JourneyCasesPage({
    client: null,
    journeyCaseSources: ['complaints'].map((s) => src(s)),
  });

  assert.ok(hasText(host, 'Journey Cases'), 'should still render heading');
  assert.ok(!findTag(host, 'cora-case-table'), 'should not render table');
});
