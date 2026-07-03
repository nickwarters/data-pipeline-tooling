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
  _active: null,
  get activeElement() {
    return this._active;
  },
  createElement(/** @type {string} */ tag) {
    const el = new StubEl();
    el.tagName = tag.toUpperCase();
    return el;
  },
};
/** @type {any} */ (globalThis).customElements = { define() {} };

const { ReviewerTeamReportPage } =
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
    caseType: 'example-review',
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

/** Flush the microtask queue enough times for fetchData()'s awaits to settle. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test('ReviewerTeamReportPage: renders a heading', async () => {
  const host = ReviewerTeamReportPage({
    client: makeClient(),
    currentUser: { id: 'user-rm', displayName: 'Morgan Manager' },
    eligibleCaseTypes: [],
  });
  await flush();
  assert.ok(
    hasText(host, 'Reviewer Team Performance'),
    'should render a heading'
  );
});

test('ReviewerTeamReportPage: renders nothing extra when client is null', async () => {
  const host = ReviewerTeamReportPage({
    client: null,
    currentUser: { id: 'user-rm', displayName: 'Morgan Manager' },
    eligibleCaseTypes: [],
  });
  await flush();
  assert.ok(hasText(host, 'Reviewer Team Performance'));
  assert.equal(findByClass(host, 'cr-kpi-tile').length, 0);
});

test('ReviewerTeamReportPage: renders nothing extra when currentUser is null', async () => {
  const host = ReviewerTeamReportPage({
    client: makeClient(),
    currentUser: null,
    eligibleCaseTypes: [],
  });
  await flush();
  assert.ok(hasText(host, 'Reviewer Team Performance'));
  assert.equal(findByClass(host, 'cr-kpi-tile').length, 0);
});

test('ReviewerTeamReportPage: renders a back link to #/reports', async () => {
  const host = ReviewerTeamReportPage({
    client: makeClient(),
    currentUser: { id: 'user-rm', displayName: 'Morgan Manager' },
    eligibleCaseTypes: [],
  });
  await flush();
  assert.ok(
    findLink(host, '#/reports'),
    'should render back link to #/reports'
  );
});

test('ReviewerTeamReportPage: renders 4 KPI tiles with correct counts', async () => {
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
  const host = ReviewerTeamReportPage({
    client: makeClient(cases),
    currentUser: { id: 'user-rm', displayName: 'Morgan Manager' },
    eligibleCaseTypes: ['example-review'],
  });
  await flush();

  const tiles = findByClass(host, 'cr-kpi-tile');
  assert.equal(tiles.length, 4, 'should render 4 KPI tiles');
  assert.ok(hasText(host, '1'), 'should show count of 1 for completed-7d');
  assert.ok(
    hasText(host, '2'),
    'should show count of 2 for completed-30d (includes 7d case)'
  );
});

test('ReviewerTeamReportPage: renders breakdown table rows per case type', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      caseType: 'example-review',
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
  const host = ReviewerTeamReportPage({
    client: makeClient(cases),
    currentUser: { id: 'user-rm', displayName: 'Morgan Manager' },
    eligibleCaseTypes: ['example-review', 'product-sale-review'],
  });
  await flush();

  const rows = findByClass(host, 'cr-breakdown-row');
  assert.equal(rows.length, 2, 'should render one row per case type with data');
  assert.ok(
    hasText(host, 'example-review'),
    'should include example-review row'
  );
  assert.ok(
    hasText(host, 'product-sale-review'),
    'should include product-sale-review row'
  );
});

test('ReviewerTeamReportPage: drill-through links navigate to #/team-cases with query params', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      caseType: 'example-review',
      status: 'In-progress',
      dueDate: new Date(Date.now() + 3 * 86400000).toISOString(),
    }),
  ];
  const host = ReviewerTeamReportPage({
    client: makeClient(cases),
    currentUser: { id: 'user-rm', displayName: 'Morgan Manager' },
    eligibleCaseTypes: ['example-review'],
  });
  await flush();

  const link = findLinkWhere(
    host,
    (href) =>
      href.startsWith('#/team-cases') &&
      href.includes('caseType=example-review') &&
      href.includes('status=outstanding')
  );
  assert.ok(
    link,
    'should render drill-through link for outstanding cases with explicit status param'
  );
});

test('ReviewerTeamReportPage: empty state when no cases', async () => {
  const host = ReviewerTeamReportPage({
    client: makeClient([]),
    currentUser: { id: 'user-rm', displayName: 'Morgan Manager' },
    eligibleCaseTypes: ['example-review'],
  });
  await flush();

  const tiles = findByClass(host, 'cr-kpi-tile');
  assert.equal(tiles.length, 4, 'should still render 4 tiles');
  assert.ok(hasText(host, '0'), 'tiles should show 0 counts');
  const rows = findByClass(host, 'cr-breakdown-row');
  assert.equal(rows.length, 0, 'breakdown table should have no rows');
});
