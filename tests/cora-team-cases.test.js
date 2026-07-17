// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  installDom,
  StubEl,
  useElementClass,
  waitFor,
  waitForRender,
} from './_dom-stub.js';
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
const { CASE_TYPE_IMPORTERS } = await import('../case-types/manifest.js');

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

  await waitForRender(host);
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

  await waitForRender(host);
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

  await waitForRender(host);
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

  await waitForRender(host);
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

  await waitForRender(host);
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

  await waitForRender(host);
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

  assert.ok(hasText(host, 'Team Cases'), 'should still render heading');
  assert.ok(
    !findTag(host, 'cora-case-table'),
    'should not render table when no client'
  );
});

test('cora-team-cases: applies Case Type dashboardColumns when filtered to a single Case Type', async () => {
  // No live Case Type declares dashboardColumns (product-sale-review, which
  // did, was retired in #383), so register a fixture importer that does for the
  // duration of this test — the same manifest-injection pattern used in
  // case-type-manifest.test.js.
  const fixtureSlug = 'dashboard-columns-fixture';
  CASE_TYPE_IMPORTERS[fixtureSlug] = async () => ({
    default: /** @type {any} */ ({
      displayName: 'Dashboard Columns Fixture',
      listName: 'Cases-DashboardColumnsFixture',
      questions: [],
      computeOutcome: () => ({ outcome: 'pass' }),
      outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
      defaultOutcomeId: 'pass',
      dashboardColumns: [
        {
          key: 'responsibleParty',
          label: 'Responsible Party',
          sortable: true,
          getValue: (/** @type {CaseRow} */ r) => r.responsibleParty,
        },
      ],
    }),
  });

  try {
    const cases = [row('c1', fixtureSlug)];
    const host = TeamCasesPage({
      client: /** @type {any} */ ({
        async listCases() {
          return cases;
        },
      }),
      currentUser: { id: 'u1', displayName: 'U' },
      caseSources: [src('complaints'), src(fixtureSlug)],
      queryString: `?manager=me&role=reviewer-manager&caseType=${fixtureSlug}`,
    });

    await waitFor(
      () => Array.isArray(findTag(host, 'cora-case-table')?.columns),
      'Case Type dashboard columns'
    );
    const table = findTag(host, 'cora-case-table');
    assert.ok(table, 'should render cora-case-table');
    assert.ok(
      Array.isArray(table.columns),
      'should pass a custom columns array when the Case Type declares dashboardColumns'
    );
    assert.ok(
      table.columns.some(
        (/** @type {any} */ c) => c.key === 'responsibleParty'
      ),
      'should include the fixture dashboardColumns column'
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
      `#/case/${fixtureSlug}/c1`,
      'Open button should navigate to the Case route'
    );
  } finally {
    delete CASE_TYPE_IMPORTERS[fixtureSlug];
  }
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

  await waitForRender(host);
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

  await waitForRender(host);
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

  await waitForRender(host);
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

  assert.ok(hasText(host, 'Team Cases'), 'should still render heading');
  assert.ok(
    !findTag(host, 'cora-case-table'),
    'should not render table when no currentUser'
  );
});
