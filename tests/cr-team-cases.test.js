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
    this.queryString = "";
    this.currentUserId = "";
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) { this._children = cs; }
  appendChild(/** @type {StubEl} */ c) { this._children.push(c); return c; }
  addEventListener() {}
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this._attrs[k] = v; }
  getAttribute(/** @type {string} */ k) { return this._attrs[k] ?? null; }
  connectedCallback() {}
}

(/** @type {any} */ (globalThis)).HTMLElement = StubEl;
(/** @type {any} */ (globalThis)).customElements = { define() {}, get() { return undefined; } };

/** @type {string[]} */
const createdTags = [];
(/** @type {any} */ (globalThis)).document = {
  createElement(/** @type {string} */ tag) {
    const el = new StubEl();
    el.tagName = tag.toUpperCase();
    createdTags.push(tag);
    return el;
  },
  createTreeWalker() { return { nextNode() { return null; } }; },
};

const { CRTeamCases } = await import('../src/pages/cr-team-cases.js');

/** @param {any} node @param {string} text @returns {boolean} */
function hasText(node, text) {
  if (typeof node.textContent === 'string' && node.textContent === text) return true;
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
  id, caseType, title: `Case ${id}`, status: 'In-progress',
  assignedReviewer: 'r', responsibleParty: 'rp',
  answers: {}, conversation: [], notes: '', completedAt: null, etag: 'e',
});

test('cr-team-cases: renders heading', async () => {
  const el = new CRTeamCases();
  el.client = /** @type {any} */ ({ async listCases() { return []; } });
  el.currentUser = { id: 'u1', displayName: 'U' };
  el.eligibleCaseTypes = ['hello-review'];
  el.queryString = '?manager=me&role=reviewer-manager';

  await el.connectedCallback();
  assert.ok(hasText(el, 'Team Cases'), 'should render "Team Cases" heading');
});

test('cr-team-cases: renders empty state when no cases returned', async () => {
  const el = new CRTeamCases();
  el.client = /** @type {any} */ ({ async listCases() { return []; } });
  el.currentUser = { id: 'u1', displayName: 'U' };
  el.eligibleCaseTypes = ['hello-review'];
  el.queryString = '?manager=me&role=reviewer-manager';

  await el.connectedCallback();
  assert.ok(hasText(el, 'No cases match the selected filters.'), 'should render empty-state message');
  assert.ok(!findTag(el, 'cr-case-table'), 'should not render cr-case-table when empty');
});

test('cr-team-cases: renders cr-case-table with cases when results returned', async () => {
  const cases = [row('c1', 'hello-review'), row('c2', 'hello-review')];
  const el = new CRTeamCases();
  el.client = /** @type {any} */ ({ async listCases() { return cases; } });
  el.currentUser = { id: 'u1', displayName: 'U' };
  el.eligibleCaseTypes = ['hello-review'];
  el.queryString = '?manager=me&role=reviewer-manager';

  await el.connectedCallback();
  const table = findTag(el, 'cr-case-table');
  assert.ok(table, 'should render cr-case-table');
  assert.deepEqual(table.cases, cases, 'should pass cases to table');
  assert.strictEqual(table.toolbar, 'hidden', 'should hide toolbar');
});

test('cr-team-cases: passes query-string params to fetcher (caseType scoping)', async () => {
  /** @type {import('../src/sharepoint-client.js').ListCasesFilter[]} */
  const calls = [];
  const el = new CRTeamCases();
  el.client = /** @type {any} */ ({
    async listCases(/** @type {any} */ f) { calls.push(f); return [row('c1', 'hello-review')]; },
  });
  el.currentUser = { id: 'u1', displayName: 'U' };
  el.eligibleCaseTypes = ['hello-review', 'product-sale-review'];
  el.queryString = '?manager=me&role=reviewer-manager&caseType=hello-review';

  await el.connectedCallback();
  assert.equal(calls.length, 1, 'should query only the specified caseType');
  assert.equal(calls[0].caseType, 'hello-review');
});

test('cr-team-cases: renders back link to #/reports', async () => {
  const el = new CRTeamCases();
  el.client = /** @type {any} */ ({ async listCases() { return []; } });
  el.currentUser = { id: 'u1', displayName: 'U' };
  el.eligibleCaseTypes = [];
  el.queryString = '';

  await el.connectedCallback();
  const link = findTag(el, 'a');
  assert.ok(link, 'should render back link');
  assert.equal(link._attrs['href'], '#/reports');
});

test('cr-team-cases: renders heading and back link without fetching when client is null', async () => {
  const el = new CRTeamCases();
  el.client = null;
  el.currentUser = { id: 'u1', displayName: 'U' };
  el.eligibleCaseTypes = [];
  el.queryString = '';

  await el.connectedCallback();
  assert.ok(hasText(el, 'Team Cases'), 'should still render heading');
  assert.ok(!findTag(el, 'cr-case-table'), 'should not render table when no client');
});
