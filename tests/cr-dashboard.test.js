// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ===== MINIMAL DOM STUBS =====
class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    /** @type {string} */
    this.tagName = '';
    this.textContent = '';
    this.className = '';
    this.href = '';
    this.hidden = false;
    /** @type {any} */
    this.client = null;
    /** @type {string} */
    this.currentUserId = '';
    /** @type {string[]} */
    this.eligibleCaseTypes = [];
    /** @type {string[]} */
    this.ownedCaseTypes = [];
    /** @type {Record<string, string>} */
    this._attrs = {};
    this.cases = null;
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
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
    this._attrs[k] = v;
  }
  getAttribute(/** @type {string} */ k) {
    return this._attrs[k] ?? null;
  }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
}

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).document = {
  /** @param {string} tag @returns {StubEl} */
  createElement(tag) {
    const el = new StubEl();
    el.tagName = tag.toUpperCase();
    return el;
  },
  addEventListener() {},
  removeEventListener() {},
};
/** @type {any} */ (globalThis).customElements = { define() {} };
/** @type {any} */ (globalThis).location = { hash: '' };

// ===== IMPORTS (after stubs) =====
const { DashboardPage } = await import('../src/pages/cr-dashboard.js');

// ===== HELPERS =====
function makeClient() {
  return {
    async listCases() {
      return [];
    },
  };
}

/** Flush a couple of microtask turns so post-fetch renders have happened. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Find every descendant element whose tagName matches.
 * @param {any} root
 * @param {string} tagName
 * @returns {StubEl[]}
 */
function findAll(root, tagName) {
  /** @type {StubEl[]} */
  const out = [];
  /** @param {StubEl} n */
  function walk(n) {
    if (n.tagName === tagName.toUpperCase()) out.push(n);
    for (const c of n._children) walk(c);
  }
  walk(root);
  return out;
}

/** @param {any} root */
function hasOutstandingCasesHeading(root) {
  return findAll(root, 'h1').some((h) => h.textContent === 'Outstanding Cases');
}

/** @param {any} root @param {string} className */
function findSection(root, className) {
  return findAll(root, 'section').find((s) => s.className === className);
}

function defaultCapabilities(overrides = {}) {
  return {
    isReviewer: false,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
    ...overrides,
  };
}

// ===== TESTS =====

test('DashboardPage: reviewer capability — outstanding Cases heading and allocation visible, no owner summary', async () => {
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-reviewer',
    capabilities: defaultCapabilities({ isReviewer: true }),
    eligibleCaseTypes: ['example-review'],
  });
  await flush();

  assert.equal(
    hasOutstandingCasesHeading(host),
    true,
    'should render Outstanding Cases heading'
  );
  assert.equal(
    findAll(host, 'cr-allocation').length,
    1,
    'should render allocation button'
  );
  assert.equal(
    findAll(host, 'cr-owner-summary').length,
    0,
    'should NOT render owner summary'
  );
});

test('DashboardPage: owner-only capability — owner summary visible, no outstanding Cases, no allocation', async () => {
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-owner',
    capabilities: defaultCapabilities({ ownedCaseTypes: ['example-review'] }),
    eligibleCaseTypes: [],
  });
  await flush();

  assert.equal(
    hasOutstandingCasesHeading(host),
    false,
    'should NOT render Outstanding Cases heading'
  );
  assert.equal(
    findAll(host, 'cr-allocation').length,
    0,
    'should NOT render allocation button'
  );
  assert.equal(
    findAll(host, 'cr-owner-summary').length,
    1,
    'should render owner summary'
  );
});

test('DashboardPage: admin capability — both reviewer and owner sections visible', async () => {
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-admin',
    capabilities: defaultCapabilities({
      isReviewer: true,
      ownedCaseTypes: ['example-review'],
    }),
    eligibleCaseTypes: ['example-review'],
  });
  await flush();

  assert.equal(
    hasOutstandingCasesHeading(host),
    true,
    'should render Outstanding Cases heading'
  );
  assert.equal(
    findAll(host, 'cr-allocation').length,
    1,
    'should render allocation button'
  );
  assert.equal(
    findAll(host, 'cr-owner-summary').length,
    1,
    'should render owner summary'
  );
});

test('DashboardPage: reviewer with no ownedCaseTypes never renders owner section (no error)', async () => {
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-reviewer',
    capabilities: defaultCapabilities({ isReviewer: true }),
    eligibleCaseTypes: ['example-review'],
  });
  // Must not throw.
  await flush();

  assert.equal(findAll(host, 'cr-owner-summary').length, 0);
});

test('DashboardPage: renders nothing and does not throw when client is null and no capabilities are set', async () => {
  const host = DashboardPage({
    client: null,
    currentUserId: '',
    capabilities: defaultCapabilities(),
    eligibleCaseTypes: [],
  });
  await flush();
  assert.equal(/** @type {any} */ (host)._children.length, 0);
});

test('DashboardPage: RP-only capability — responsible party dashboard rendered, reviewer sections absent', async () => {
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-rp',
    capabilities: defaultCapabilities({ isAdviser: true }),
    eligibleCaseTypes: [],
  });
  await flush();

  assert.ok(
    findSection(host, 'cr-rp-outcome-summary'),
    'should render RP outcome summary section'
  );
  assert.ok(
    findSection(host, 'cr-rp-remediation'),
    'should render RP remediation section'
  );
  assert.ok(
    findSection(host, 'cr-rp-messages'),
    'should render RP messages section'
  );
  assert.equal(
    hasOutstandingCasesHeading(host),
    false,
    'should NOT render reviewer heading'
  );
  assert.equal(
    findAll(host, 'cr-allocation').length,
    0,
    'should NOT render allocation button'
  );
  assert.equal(
    findAll(host, 'cr-owner-summary').length,
    0,
    'should NOT render owner summary'
  );
});

test('DashboardPage: reviewer + RP capability — both reviewer and RP sections visible', async () => {
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-reviewer-rp',
    capabilities: defaultCapabilities({ isReviewer: true, isAdviser: true }),
    eligibleCaseTypes: ['example-review'],
  });
  await flush();

  assert.equal(
    hasOutstandingCasesHeading(host),
    true,
    'should render reviewer heading'
  );
  assert.equal(
    findAll(host, 'cr-allocation').length,
    1,
    'should render allocation button'
  );
  assert.ok(
    findSection(host, 'cr-rp-outcome-summary'),
    'should render RP section'
  );
});

test('DashboardPage: RP dashboard fetches cases with responsibleParty filter using currentUserId', async () => {
  /** @type {any[]} */
  const calls = [];
  const client = {
    async listCases(/** @type {any} */ f) {
      calls.push(f);
      return [];
    },
  };
  DashboardPage({
    client: /** @type {any} */ (client),
    currentUserId: 'user-rp',
    capabilities: defaultCapabilities({ isAdviser: true }),
    eligibleCaseTypes: [],
  });
  await flush();

  assert.ok(
    calls.some(
      (f) => f.responsibleParty === 'user-rp' && !('assignedReviewer' in f)
    ),
    'RP dashboard should list cases filtered by responsibleParty'
  );
});

test('DashboardPage: open button in RP unread-messages section navigates to conversation hash via onOpenConversation', async () => {
  /** @type {any} */ (globalThis).location.hash = '';
  const caseRow = {
    id: 'c-42',
    caseType: 'example-review',
    title: 'Case 42',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {},
    conversation: [
      { author: 'user-reviewer', timestamp: '2026-05-07T09:00:00Z', body: 'Q' },
    ],
    notes: '',
    completedAt: null,
    etag: 'e1',
  };
  const client = {
    async listCases() {
      return [caseRow];
    },
  };
  const host = DashboardPage({
    client: /** @type {any} */ (client),
    currentUserId: 'user-rp',
    capabilities: defaultCapabilities({ isAdviser: true }),
    eligibleCaseTypes: [],
  });
  await flush();

  const messagesSection = findSection(host, 'cr-rp-messages');
  assert.ok(messagesSection, 'messages section should exist');
  const messagesTable = findAll(messagesSection, 'cr-case-table')[0];
  assert.ok(messagesTable, 'messages case table should exist');
  for (const h of /** @type {any} */ (messagesTable)._listeners[
    'cr-case-open'
  ] ?? []) {
    h({ detail: { caseRow } });
  }

  assert.equal(
    /** @type {any} */ (globalThis).location.hash,
    '#/conversation/example-review/c-42'
  );
});

test('DashboardPage: cr-allocation element listens for cr-allocated and re-fetches cases on allocation', async () => {
  let fetchCount = 0;
  const client = {
    async listCases() {
      fetchCount++;
      return [];
    },
  };

  const host = DashboardPage({
    client: /** @type {any} */ (client),
    currentUserId: 'user-reviewer',
    capabilities: defaultCapabilities({ isReviewer: true }),
    eligibleCaseTypes: ['example-review'],
  });
  await flush();
  const initialFetchCount = fetchCount;

  const allocationEls = findAll(host, 'cr-allocation');
  assert.equal(allocationEls.length, 1, 'should have allocation element');

  const allocEvent = { type: 'cr-allocated', detail: { caseId: 'c-new' } };
  for (const h of /** @type {any} */ (allocationEls[0])._listeners[
    'cr-allocated'
  ] ?? []) {
    await h(allocEvent);
  }

  assert.ok(
    fetchCount > initialFetchCount,
    'should re-fetch cases after cr-allocated event'
  );
});

test('DashboardPage: cr-case-open event on case table navigates to #/case/{id}', async () => {
  /** @type {any} */ (globalThis).location.hash = '';
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-reviewer',
    capabilities: defaultCapabilities({ isReviewer: true }),
    eligibleCaseTypes: [],
  });
  await flush();

  const caseTable = findAll(host, 'cr-case-table')[0];
  assert.ok(caseTable, 'should have a case table');

  const event = {
    type: 'cr-case-open',
    detail: {
      caseId: 'case-42',
      caseRow: { id: 'case-42', caseType: 'example-review' },
    },
  };
  for (const h of /** @type {any} */ (caseTable)._listeners['cr-case-open'] ??
    []) {
    h(event);
  }

  assert.equal(
    /** @type {any} */ (globalThis).location.hash,
    '#/case/example-review/case-42'
  );
});

// --- overdue flag ---

test('DashboardPage: stamps overdue:true on rows whose dueDate is in the past', async () => {
  const PAST = '2020-01-01T00:00:00Z';
  const FUTURE = '2099-01-01T00:00:00Z';
  /** @type {import('../src/sharepoint-client.js').CaseRow[]} */
  const fetchedCases = [
    {
      id: 'od-past',
      caseType: 'example-review',
      title: 'Overdue',
      status: 'In-progress',
      assignedReviewer: 'u1',
      responsibleParty: '',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: null,
      dueDate: PAST,
      etag: 'e1',
    },
    {
      id: 'od-future',
      caseType: 'example-review',
      title: 'On Time',
      status: 'In-progress',
      assignedReviewer: 'u1',
      responsibleParty: '',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: null,
      dueDate: FUTURE,
      etag: 'e2',
    },
    {
      id: 'od-none',
      caseType: 'example-review',
      title: 'No Due Date',
      status: 'In-progress',
      assignedReviewer: 'u1',
      responsibleParty: '',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: null,
      etag: 'e3',
    },
  ];

  const client = {
    async listCases() {
      return fetchedCases;
    },
  };
  const host = DashboardPage({
    client: /** @type {any} */ (client),
    currentUserId: 'u1',
    capabilities: defaultCapabilities({ isReviewer: true }),
    eligibleCaseTypes: [],
  });
  await flush();

  const caseTable = /** @type {any} */ (findAll(host, 'cr-case-table')[0]);
  const rows = /** @type {import('../src/sharepoint-client.js').CaseRow[]} */ (
    caseTable.cases
  );
  assert.ok(Array.isArray(rows), 'case table should have cases set');

  const pastRow = rows.find((r) => r.id === 'od-past');
  const futureRow = rows.find((r) => r.id === 'od-future');
  const noneRow = rows.find((r) => r.id === 'od-none');

  assert.strictEqual(
    pastRow?.overdue,
    true,
    'past dueDate row should be flagged overdue'
  );
  assert.strictEqual(
    futureRow?.overdue,
    false,
    'future dueDate row should not be overdue'
  );
  assert.strictEqual(
    noneRow?.overdue,
    false,
    'no-dueDate row should not be overdue'
  );
});
