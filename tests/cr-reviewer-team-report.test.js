// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, string>} */
    this._attrs = {};
    /** @type {string} */
    this.tagName = '';
    this.textContent = '';
    this.className = '';
    /** @type {any} */
    this.client = null;
    /** @type {any} */
    this.currentUser = null;
    /** @type {string[]} */
    this.eligibleCaseTypes = [];
    this.cases = null;
    this.currentUserId = '';
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) {
    this._children = cs;
  }
  appendChild(/** @type {StubEl} */ c) {
    this._children.push(c);
    return c;
  }
  append(/** @type {StubEl[]} */ ...cs) {
    this._children.push(...cs);
  }
  addEventListener() {}
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
    this._attrs[k] = v;
  }
  getAttribute(/** @type {string} */ k) {
    return this._attrs[k] ?? null;
  }
}

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).document = {
  createElement(/** @type {string} */ tag) {
    const el = new StubEl();
    el.tagName = tag.toUpperCase();
    return el;
  },
};
/** @type {any} */ (globalThis).customElements = { define() {} };

const { CRReviewerTeamReport } =
  await import('../src/pages/cr-reviewer-team-report.js');

/** @param {any} node @param {string} text @returns {boolean} */
function hasText(node, text) {
  if (typeof node.textContent === 'string' && node.textContent.includes(text))
    return true;
  for (const c of node._children ?? []) {
    if (hasText(c, text)) return true;
  }
  return false;
}

/** @param {any} node @param {string} href @returns {any|null} */
function findLink(node, href) {
  if (node.tagName === 'A' && node._attrs['href'] === href) return node;
  for (const c of node._children ?? []) {
    const f = findLink(c, href);
    if (f) return f;
  }
  return null;
}

/** @param {any} node @param {(href: string) => boolean} pred @returns {any|null} */
function findLinkWhere(node, pred) {
  if (
    node.tagName === 'A' &&
    typeof node._attrs['href'] === 'string' &&
    pred(node._attrs['href'])
  )
    return node;
  for (const c of node._children ?? []) {
    const f = findLinkWhere(c, pred);
    if (f) return f;
  }
  return null;
}

/**
 * Find all elements with a given class (checked on className string).
 * @param {any} node @param {string} cls @returns {StubEl[]}
 */
function findByClass(node, cls) {
  /** @type {StubEl[]} */
  const out = [];
  if (
    typeof node.className === 'string' &&
    node.className.split(' ').includes(cls)
  )
    out.push(node);
  for (const c of node._children ?? []) out.push(...findByClass(c, cls));
  return out;
}

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

const NOW = new Date(2026, 4, 17, 15, 0, 0);

/** @param {CaseRow[]} cases @returns {any} */
function makeClient(cases = []) {
  return {
    async listCases() {
      return cases.map((c) => ({ ...c }));
    },
  };
}

/** @param {Partial<CaseRow>} overrides @returns {CaseRow} */
function makeCase(overrides) {
  return {
    id: 'c1',
    caseType: 'hello-review',
    title: 'T',
    status: 'In-progress',
    assignedReviewer: 'r',
    responsibleParty: 'rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'e',
    assignedReviewerManager: 'user-rm',
    ...overrides,
  };
}

test('cr-reviewer-team-report: renders a heading', async () => {
  const el = new CRReviewerTeamReport();
  el.client = makeClient();
  el.currentUser = { id: 'user-rm', displayName: 'Morgan Manager' };
  el.eligibleCaseTypes = [];
  await el.connectedCallback();
  assert.ok(
    hasText(el, 'Reviewer Team Performance'),
    'should render a heading'
  );
});

test('cr-reviewer-team-report: renders a back link to #/reports', async () => {
  const el = new CRReviewerTeamReport();
  el.client = makeClient();
  el.currentUser = { id: 'user-rm', displayName: 'Morgan Manager' };
  el.eligibleCaseTypes = [];
  await el.connectedCallback();
  assert.ok(findLink(el, '#/reports'), 'should render back link to #/reports');
});

test('cr-reviewer-team-report: renders 4 KPI tiles with correct counts', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      status: 'Completed',
      completedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    }), // in 7d
    makeCase({
      id: 'c2',
      status: 'Completed',
      completedAt: new Date(Date.now() - 14 * 86400000).toISOString(),
    }), // in 30d only
    makeCase({
      id: 'c3',
      status: 'In-progress',
      dueDate: new Date(Date.now() + 3 * 86400000).toISOString(),
    }), // outstanding
    makeCase({
      id: 'c4',
      status: 'In-progress',
      dueDate: new Date(Date.now() - 3 * 86400000).toISOString(),
    }), // overdue
  ];
  const el = new CRReviewerTeamReport();
  el.client = makeClient(cases);
  el.currentUser = { id: 'user-rm', displayName: 'Morgan Manager' };
  el.eligibleCaseTypes = ['hello-review'];
  await el.connectedCallback();

  const tiles = findByClass(el, 'cr-kpi-tile');
  assert.equal(tiles.length, 4, 'should render 4 KPI tiles');
  assert.ok(hasText(el, '1'), 'should show count of 1 for completed-7d');
  assert.ok(
    hasText(el, '2'),
    'should show count of 2 for completed-30d (includes 7d case)'
  );
});

test('cr-reviewer-team-report: renders breakdown table rows per case type', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      caseType: 'hello-review',
      status: 'Completed',
      completedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    }),
    makeCase({
      id: 'c2',
      caseType: 'product-sale-review',
      status: 'In-progress',
      dueDate: new Date(Date.now() + 3 * 86400000).toISOString(),
    }),
  ];
  const el = new CRReviewerTeamReport();
  el.client = makeClient(cases);
  el.currentUser = { id: 'user-rm', displayName: 'Morgan Manager' };
  el.eligibleCaseTypes = ['hello-review', 'product-sale-review'];
  await el.connectedCallback();

  const rows = findByClass(el, 'cr-breakdown-row');
  assert.equal(rows.length, 2, 'should render one row per case type with data');
  assert.ok(hasText(el, 'hello-review'), 'should include hello-review row');
  assert.ok(
    hasText(el, 'product-sale-review'),
    'should include product-sale-review row'
  );
});

test('cr-reviewer-team-report: drill-through links navigate to #/team-cases with query params', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      caseType: 'hello-review',
      status: 'In-progress',
      dueDate: new Date(Date.now() + 3 * 86400000).toISOString(),
    }),
  ];
  const el = new CRReviewerTeamReport();
  el.client = makeClient(cases);
  el.currentUser = { id: 'user-rm', displayName: 'Morgan Manager' };
  el.eligibleCaseTypes = ['hello-review'];
  await el.connectedCallback();

  const link = findLinkWhere(
    el,
    (href) =>
      href.startsWith('#/team-cases') &&
      href.includes('caseType=hello-review') &&
      href.includes('status=outstanding')
  );
  assert.ok(
    link,
    'should render drill-through link for outstanding cases with explicit status param'
  );
});

test('cr-reviewer-team-report: empty state when no cases', async () => {
  const el = new CRReviewerTeamReport();
  el.client = makeClient([]);
  el.currentUser = { id: 'user-rm', displayName: 'Morgan Manager' };
  el.eligibleCaseTypes = ['hello-review'];
  await el.connectedCallback();

  const tiles = findByClass(el, 'cr-kpi-tile');
  assert.equal(tiles.length, 4, 'should still render 4 tiles');
  assert.ok(hasText(el, '0'), 'tiles should show 0 counts');
  const rows = findByClass(el, 'cr-breakdown-row');
  assert.equal(rows.length, 0, 'breakdown table should have no rows');
});
