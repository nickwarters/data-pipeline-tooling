// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, string>} */
    this._attrs = {};
    this.tagName = '';
    this.textContent = '';
    this.className = '';
    /** @type {any} */
    this.cases = null;
    /** @type {any} */
    this.toolbar = null;
    this.connectedCallbackCalled = false;
    this.client = null;
    this.currentUser = null;
    this.eligibleCaseTypes = [];
    this.queryString = '';
    this.currentUserId = '';
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) {
    this._children = cs;
  }
  appendChild(/** @type {StubEl} */ c) {
    this._children.push(c);
    return c;
  }
  addEventListener() {}
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
    this._attrs[k] = v;
  }
  getAttribute(/** @type {string} */ k) {
    return this._attrs[k] ?? null;
  }
  connectedCallback() {}
}

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).customElements = {
  define() {},
  get() {
    return undefined;
  },
};

/** @type {string[]} */
const createdTags = [];
/** @type {any} */ (globalThis).document = {
  activeElement: null,
  createElement(/** @type {string} */ tag) {
    const el = new StubEl();
    el.tagName = tag.toUpperCase();
    createdTags.push(tag);
    return el;
  },
  createTreeWalker() {
    return {
      nextNode() {
        return null;
      },
    };
  },
};

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

/** @returns {Promise<void>} flushes pending microtask fetch + reactive re-render */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

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
