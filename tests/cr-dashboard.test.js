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
const { CRDashboard } = await import('../src/pages/cr-dashboard.js');

// ===== HELPERS =====
function makeClient() {
  return {
    async listCases() {
      return [];
    },
  };
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

// ===== TESTS =====

test('CRDashboard: reviewer capability — outstanding Cases heading and allocation visible, no owner summary', async () => {
  const el = new CRDashboard();
  el.client = /** @type {any} */ (makeClient());
  el.currentUserId = 'user-reviewer';
  el.capabilities = {
    isReviewer: true,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  el.eligibleCaseTypes = ['example-review'];

  await el.connectedCallback();

  assert.equal(
    hasOutstandingCasesHeading(el),
    true,
    'should render Outstanding Cases heading'
  );
  assert.equal(
    findAll(el, 'cr-allocation').length,
    1,
    'should render allocation button'
  );
  assert.equal(
    findAll(el, 'cr-owner-summary').length,
    0,
    'should NOT render owner summary'
  );
});

test('CRDashboard: owner-only capability — owner summary visible, no outstanding Cases, no allocation', async () => {
  const el = new CRDashboard();
  el.client = /** @type {any} */ (makeClient());
  el.currentUserId = 'user-owner';
  el.capabilities = {
    isReviewer: false,
    ownedCaseTypes: ['example-review'],
    isAdviser: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  el.eligibleCaseTypes = [];

  await el.connectedCallback();

  assert.equal(
    hasOutstandingCasesHeading(el),
    false,
    'should NOT render Outstanding Cases heading'
  );
  assert.equal(
    findAll(el, 'cr-allocation').length,
    0,
    'should NOT render allocation button'
  );
  assert.equal(
    findAll(el, 'cr-owner-summary').length,
    1,
    'should render owner summary'
  );
});

test('CRDashboard: admin capability — both reviewer and owner sections visible', async () => {
  const el = new CRDashboard();
  el.client = /** @type {any} */ (makeClient());
  el.currentUserId = 'user-admin';
  el.capabilities = {
    isReviewer: true,
    ownedCaseTypes: ['example-review'],
    isAdviser: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  el.eligibleCaseTypes = ['example-review'];

  await el.connectedCallback();

  assert.equal(
    hasOutstandingCasesHeading(el),
    true,
    'should render Outstanding Cases heading'
  );
  assert.equal(
    findAll(el, 'cr-allocation').length,
    1,
    'should render allocation button'
  );
  assert.equal(
    findAll(el, 'cr-owner-summary').length,
    1,
    'should render owner summary'
  );
});

test('CRDashboard: reviewer with no ownedCaseTypes never renders owner section (no error)', async () => {
  const el = new CRDashboard();
  el.client = /** @type {any} */ (makeClient());
  el.currentUserId = 'user-reviewer';
  el.capabilities = {
    isReviewer: true,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  el.eligibleCaseTypes = ['example-review'];

  // Must not throw.
  await el.connectedCallback();

  assert.equal(findAll(el, 'cr-owner-summary').length, 0);
});

test('CRDashboard: connectedCallback does nothing when client is null', async () => {
  const el = new CRDashboard();
  el.client = null;
  await el.connectedCallback();
  assert.equal(/** @type {any} */ (el)._children.length, 0);
});

test('CRDashboard: RP-only capability — cr-responsible-party-dashboard rendered, reviewer sections absent', async () => {
  const el = new CRDashboard();
  el.client = /** @type {any} */ (makeClient());
  el.currentUserId = 'user-rp';
  el.capabilities = {
    isReviewer: false,
    ownedCaseTypes: [],
    isAdviser: true,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };

  await el.connectedCallback();

  assert.equal(
    findAll(el, 'cr-responsible-party-dashboard').length,
    1,
    'should render RP section'
  );
  assert.equal(
    hasOutstandingCasesHeading(el),
    false,
    'should NOT render reviewer heading'
  );
  assert.equal(
    findAll(el, 'cr-allocation').length,
    0,
    'should NOT render allocation button'
  );
  assert.equal(
    findAll(el, 'cr-owner-summary').length,
    0,
    'should NOT render owner summary'
  );
});

test('CRDashboard: reviewer + RP capability — both reviewer and RP sections visible', async () => {
  const el = new CRDashboard();
  el.client = /** @type {any} */ (makeClient());
  el.currentUserId = 'user-reviewer-rp';
  el.capabilities = {
    isReviewer: true,
    ownedCaseTypes: [],
    isAdviser: true,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  el.eligibleCaseTypes = ['example-review'];

  await el.connectedCallback();

  assert.equal(
    hasOutstandingCasesHeading(el),
    true,
    'should render reviewer heading'
  );
  assert.equal(
    findAll(el, 'cr-allocation').length,
    1,
    'should render allocation button'
  );
  assert.equal(
    findAll(el, 'cr-responsible-party-dashboard').length,
    1,
    'should render RP section'
  );
});

test('CRDashboard: cr-open-conversation from RP section navigates to conversation hash', async () => {
  /** @type {any} */ (globalThis).location.hash = '';
  const el = new CRDashboard();
  el.client = /** @type {any} */ (makeClient());
  el.currentUserId = 'user-rp';
  el.capabilities = {
    isReviewer: false,
    ownedCaseTypes: [],
    isAdviser: true,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };

  await el.connectedCallback();

  const rpEl = findAll(el, 'cr-responsible-party-dashboard')[0];
  assert.ok(rpEl, 'RP element should exist');
  const handler = /** @type {any} */ (rpEl)._listeners[
    'cr-open-conversation'
  ]?.[0];
  assert.ok(handler, 'should have cr-open-conversation listener');
  handler({
    detail: {
      caseId: 'c-42',
      caseRow: { id: 'c-42', caseType: 'example-review' },
    },
  });
  assert.equal(
    /** @type {any} */ (globalThis).location.hash,
    '#/conversation/example-review/c-42'
  );
});

test('CRDashboard: RP section gets client and currentUserId set', async () => {
  const client = makeClient();
  const el = new CRDashboard();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-rp';
  el.capabilities = {
    isReviewer: false,
    ownedCaseTypes: [],
    isAdviser: true,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };

  await el.connectedCallback();

  const rpEl = findAll(el, 'cr-responsible-party-dashboard')[0];
  assert.ok(rpEl, 'RP element should exist');
  assert.equal(
    /** @type {any} */ (rpEl).client,
    client,
    'client should be passed through'
  );
  assert.equal(
    /** @type {any} */ (rpEl).currentUserId,
    'user-rp',
    'currentUserId should be passed through'
  );
});

test('CRDashboard: cr-allocation element listens for cr-allocated and re-fetches cases on allocation', async () => {
  let fetchCount = 0;
  const client = {
    async listCases() {
      fetchCount++;
      return [];
    },
  };

  const el = new CRDashboard();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.capabilities = {
    isReviewer: true,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  el.eligibleCaseTypes = ['example-review'];

  await el.connectedCallback();
  const initialFetchCount = fetchCount;

  // Find the cr-allocation element and fire the cr-allocated event on it
  const allocationEls = findAll(el, 'cr-allocation');
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

test('CRDashboard: cr-case-open event on case table navigates to #/case/{id}', async () => {
  const el = new CRDashboard();
  el.client = /** @type {any} */ (makeClient());
  el.currentUserId = 'user-reviewer';
  el.capabilities = {
    isReviewer: true,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  el.eligibleCaseTypes = [];

  /** @type {any} */ (globalThis).location.hash = '';
  await el.connectedCallback();

  const caseTable = findAll(el, 'cr-case-table')[0];
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

test('CRDashboard: stamps overdue:true on rows whose dueDate is in the past', async () => {
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
  const el = new CRDashboard();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'u1';
  el.capabilities = {
    isReviewer: true,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  el.eligibleCaseTypes = [];
  await el.connectedCallback();

  const caseTable = /** @type {any} */ (findAll(el, 'cr-case-table')[0]);
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
