// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl, useElementClass, flush } from './_dom-stub.js';
import { assertAllCoraElementsDefined } from './helpers/assert-defined-elements.js';

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
    this.connectedCallbackCalled = false;
    /** @type {any} */
    this.client = null;
    /** @type {any} */
    this.currentUser = null;
    /** @type {import('../src/setup/resolve-eligible-case-types.js').CaseSource[]} */
    this.caseSources = [];
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

const { TeamCasesPage, resolveDashboardColumns } =
  await import('../src/pages/cora-team-cases.js');

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

/**
 * Flush enough turns for fetchData() to settle when the page also loads a
 * Case Type config: loadCaseTypeConfig() performs a real dynamic import() of
 * the case-type module, and the module performs a top-level bank-file read, so
 * allow a few macrotask turns in addition to microtask flushes.
 */
async function flushDeep() {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  }
}

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

test('cora-team-cases: renders heading', async () => {
  const host = TeamCasesPage({
    client: /** @type {any} */ ({
      async listCases() {
        return [];
      },
    }),
    currentUser: { id: 'u1', displayName: 'U' },
    caseSources: [src('example-review')],
    queryString: '?manager=me&role=reviewer-manager',
  });

  await flush();
  assert.ok(hasText(host, 'Team Cases'), 'should render "Team Cases" heading');
});

test('cora-team-cases: renders empty state when no cases returned', async () => {
  const host = TeamCasesPage({
    client: /** @type {any} */ ({
      async listCases() {
        return [];
      },
    }),
    currentUser: { id: 'u1', displayName: 'U' },
    caseSources: [src('example-review')],
    queryString: '?manager=me&role=reviewer-manager',
  });

  await flush();
  assert.ok(
    hasText(host, 'No cases match the selected filters.'),
    'should render empty-state message'
  );
  assert.ok(
    !findTag(host, 'cora-case-table'),
    'should not render cora-case-table when empty'
  );
});

test('cora-team-cases: renders cora-case-table with cases when results returned', async () => {
  const cases = [row('c1', 'example-review'), row('c2', 'example-review')];
  const host = TeamCasesPage({
    client: /** @type {any} */ ({
      async listCases() {
        return cases;
      },
    }),
    currentUser: { id: 'u1', displayName: 'U' },
    caseSources: [src('example-review')],
    queryString: '?manager=me&role=reviewer-manager',
  });

  await flush();
  const table = findTag(host, 'cora-case-table');
  assert.ok(table, 'should render cora-case-table');
  assert.deepEqual(table.cases, cases, 'should pass cases to table');
  assert.strictEqual(table.toolbar, 'hidden', 'should hide toolbar');
  assertAllCoraElementsDefined(host);
});

test('cora-team-cases: passes query-string params to fetcher (caseType scoping)', async () => {
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
    caseSources: [src('example-review'), src('product-sale-review')],
    queryString: '?manager=me&role=reviewer-manager&caseType=example-review',
  });

  await flush();
  assert.equal(calls.length, 1, 'should query only the specified caseType');
  assert.equal(calls[0].caseType, 'example-review');
});

test('cora-team-cases: passes an explicit { listName } to the fetcher', async () => {
  /** @type {import('../src/sharepoint-client.js').CaseListOptions[]} */
  const opts = [];
  const host = TeamCasesPage({
    client: /** @type {any} */ ({
      async listCases(/** @type {any} */ f, /** @type {any} */ o) {
        opts.push(o);
        return [];
      },
    }),
    currentUser: { id: 'u1', displayName: 'U' },
    caseSources: [src('example-review', 'ExampleReviews')],
    queryString: '?manager=me&role=reviewer-manager',
  });

  await flush();
  assert.equal(opts.length, 1);
  assert.equal(opts[0].listName, 'ExampleReviews');
});

test('cora-team-cases: renders back link to #/reports', async () => {
  const host = TeamCasesPage({
    client: /** @type {any} */ ({
      async listCases() {
        return [];
      },
    }),
    currentUser: { id: 'u1', displayName: 'U' },
    caseSources: [],
    queryString: '',
  });

  await flush();
  const link = findTag(host, 'a');
  assert.ok(link, 'should render back link');
  assert.equal(link._attrs['href'], '#/reports');
});

test('cora-team-cases: renders heading and back link without fetching when client is null', async () => {
  const host = TeamCasesPage({
    client: null,
    currentUser: { id: 'u1', displayName: 'U' },
    caseSources: [],
    queryString: '',
  });

  await flush();
  assert.ok(hasText(host, 'Team Cases'), 'should still render heading');
  assert.ok(
    !findTag(host, 'cora-case-table'),
    'should not render table when no client'
  );
});

test('cora-team-cases: applies Case Type dashboardColumns when filtered to a single Case Type', async () => {
  const cases = [row('c1', 'product-sale-review')];
  const host = TeamCasesPage({
    client: /** @type {any} */ ({
      async listCases() {
        return cases;
      },
    }),
    currentUser: { id: 'u1', displayName: 'U' },
    caseSources: [src('example-review'), src('product-sale-review')],
    queryString:
      '?manager=me&role=reviewer-manager&caseType=product-sale-review',
  });

  await flushDeep();
  const table = findTag(host, 'cora-case-table');
  assert.ok(table, 'should render cora-case-table');
  assert.ok(
    Array.isArray(table.columns),
    'should pass a custom columns array when the Case Type declares dashboardColumns'
  );
  assert.ok(
    table.columns.some((/** @type {any} */ c) => c.key === 'responsibleParty'),
    'should include the product-sale-review dashboardColumns column'
  );

  // The appended columns follow the full default set, so the Actions column's
  // Open button still navigates to the Case route.
  const actionsCol = table.columns.find(
    (/** @type {any} */ c) => c.key === 'actions'
  );
  assert.ok(actionsCol, 'default Actions column should still be present');
  const btn = actionsCol.renderCell(cases[0]);
  btn._fire('click');
  assert.equal(
    /** @type {any} */ (globalThis).location.hash,
    '#/case/product-sale-review/c1',
    'Open button should navigate to the Case route'
  );
});

test('cora-team-cases: keeps default columns when the filtered Case Type declares no dashboardColumns', async () => {
  const cases = [row('c1', 'example-review')];
  const host = TeamCasesPage({
    client: /** @type {any} */ ({
      async listCases() {
        return cases;
      },
    }),
    currentUser: { id: 'u1', displayName: 'U' },
    caseSources: [src('example-review'), src('product-sale-review')],
    queryString: '?manager=me&role=reviewer-manager&caseType=example-review',
  });

  await flushDeep();
  const table = findTag(host, 'cora-case-table');
  assert.ok(table, 'should render cora-case-table');
  assert.strictEqual(
    table.columns,
    null,
    'a Case Type without dashboardColumns must be pixel-identical (no custom columns prop)'
  );
});

test('cora-team-cases: ignores dashboardColumns lookup for an unknown Case Type slug', async () => {
  const cases = [row('c1', 'nope')];
  const host = TeamCasesPage({
    client: /** @type {any} */ ({
      async listCases() {
        return cases;
      },
    }),
    currentUser: { id: 'u1', displayName: 'U' },
    caseSources: [src('example-review'), src('nope')],
    queryString: '?manager=me&role=reviewer-manager&caseType=nope',
  });

  await flushDeep();
  const table = findTag(host, 'cora-case-table');
  assert.ok(table, 'should still render cora-case-table');
  assert.strictEqual(
    table.columns,
    null,
    'unknown Case Type slug should fall back to default columns'
  );
});

test('cora-team-cases: does NOT apply dashboardColumns in a mixed multi-Case-Type view', async () => {
  const cases = [row('c1', 'product-sale-review'), row('c2', 'example-review')];
  const host = TeamCasesPage({
    client: /** @type {any} */ ({
      async listCases() {
        return cases;
      },
    }),
    currentUser: { id: 'u1', displayName: 'U' },
    caseSources: [src('example-review'), src('product-sale-review')],
    // No caseType param: fans out across both eligible Case Types (mixed view).
    queryString: '?manager=me&role=reviewer-manager',
  });

  await flushDeep();
  const table = findTag(host, 'cora-case-table');
  assert.ok(table, 'should render cora-case-table');
  assert.strictEqual(
    table.columns,
    null,
    'should not apply per-Case-Type dashboardColumns in a mixed view'
  );
});

test('cora-team-cases: resolveDashboardColumns rethrows non-UnknownCaseTypeError failures', async () => {
  const boom = new Error('config load failed');
  await assert.rejects(
    resolveDashboardColumns('example-review', async () => {
      throw boom;
    }),
    boom
  );
});

test('cora-team-cases: renders heading and back link without fetching when currentUser is null', async () => {
  const host = TeamCasesPage({
    client: /** @type {any} */ ({
      async listCases() {
        return [];
      },
    }),
    currentUser: null,
    caseSources: [],
    queryString: '',
  });

  await flush();
  assert.ok(hasText(host, 'Team Cases'), 'should still render heading');
  assert.ok(
    !findTag(host, 'cora-case-table'),
    'should not render table when no currentUser'
  );
});
