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
    this.textContent = '';
    this.className = '';
    this.href = '';
    this.hidden = false;
    /** @type {string[]} */
    this.ownedCaseTypes = [];
    /** @type {any} */
    this.client = null;
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
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
}

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).document = {
  /** @param {string} _tag @returns {StubEl} */
  createElement(_tag) {
    return new StubEl();
  },
  addEventListener() {},
  removeEventListener() {},
};
/** @type {any} */ (globalThis).customElements = { define() {} };

// ===== IMPORTS (after stubs) =====
const { CROwnerSummary } =
  await import('../src/components/cr-owner-summary.js');

// ===== HELPERS =====
const now = new Date();
const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const sevenDaysAgo = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
const threeDaysAgo = new Date(todayStart.getTime() - 3 * 24 * 60 * 60 * 1000);
const tenDaysAgo = new Date(todayStart.getTime() - 10 * 24 * 60 * 60 * 1000);

/** @param {import('../src/sharepoint-client.js').CaseRow[]} casesForType */
function makeClient(casesForType) {
  return {
    async listCases(
      /** @type {import('../src/sharepoint-client.js').ListCasesFilter} */ _filter
    ) {
      return casesForType.map((c) => ({ ...c }));
    },
  };
}

// ===== TESTS =====

test('CROwnerSummary: connectedCallback does nothing when ownedCaseTypes is empty', async () => {
  const el = new CROwnerSummary();
  el.client = /** @type {any} */ (makeClient([]));
  el.ownedCaseTypes = [];
  await el.connectedCallback();
  assert.equal(/** @type {any} */ (el)._children.length, 0);
});

test('CROwnerSummary: connectedCallback does nothing when client is null', async () => {
  const el = new CROwnerSummary();
  el.client = null;
  el.ownedCaseTypes = ['hello-review'];
  await el.connectedCallback();
  assert.equal(/** @type {any} */ (el)._children.length, 0);
});

test('CROwnerSummary: calls listCases with caseType filter for each owned type', async () => {
  /** @type {import('../src/sharepoint-client.js').ListCasesFilter[]} */
  const calls = [];
  const el = new CROwnerSummary();
  el.client = /** @type {any} */ ({
    async listCases(
      /** @type {import('../src/sharepoint-client.js').ListCasesFilter} */ f
    ) {
      calls.push(f);
      return [];
    },
  });
  el.ownedCaseTypes = ['hello-review', 'audit-review'];
  await el.connectedCallback();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { caseType: 'hello-review' });
  assert.deepEqual(calls[1], { caseType: 'audit-review' });
});

test('CROwnerSummary: stores summaries on _summaries after _refresh', async () => {
  const el = new CROwnerSummary();
  el.client = /** @type {any} */ (makeClient([]));
  el.ownedCaseTypes = ['hello-review'];
  await el.connectedCallback();
  assert.ok(Array.isArray(el._summaries), '_summaries should be set');
  assert.equal(el._summaries.length, 1);
  assert.equal(el._summaries[0].caseType, 'hello-review');
});

test('CROwnerSummary: outstanding count = unassigned in-progress cases', async () => {
  /** @type {import('../src/sharepoint-client.js').CaseRow[]} */
  const fixtureCases = [
    {
      id: 'c1',
      caseType: 'hello-review',
      title: 'C1',
      status: 'In-progress',
      assignedReviewer: '',
      responsibleParty: 'rp',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: null,
      etag: 'e1',
    },
    {
      id: 'c2',
      caseType: 'hello-review',
      title: 'C2',
      status: 'In-progress',
      assignedReviewer: 'user-x',
      responsibleParty: 'rp',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: null,
      etag: 'e2',
    },
  ];
  const el = new CROwnerSummary();
  el.client = /** @type {any} */ (makeClient(fixtureCases));
  el.ownedCaseTypes = ['hello-review'];
  await el.connectedCallback();
  assert.equal(el._summaries[0].outstanding, 1);
});

test('CROwnerSummary: assigned count = in-progress cases with an assigned reviewer', async () => {
  /** @type {import('../src/sharepoint-client.js').CaseRow[]} */
  const fixtureCases = [
    {
      id: 'c1',
      caseType: 'hello-review',
      title: 'C1',
      status: 'In-progress',
      assignedReviewer: '',
      responsibleParty: 'rp',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: null,
      etag: 'e1',
    },
    {
      id: 'c2',
      caseType: 'hello-review',
      title: 'C2',
      status: 'In-progress',
      assignedReviewer: 'user-x',
      responsibleParty: 'rp',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: null,
      etag: 'e2',
    },
    {
      id: 'c3',
      caseType: 'hello-review',
      title: 'C3',
      status: 'In-progress',
      assignedReviewer: 'user-y',
      responsibleParty: 'rp',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: null,
      etag: 'e3',
    },
  ];
  const el = new CROwnerSummary();
  el.client = /** @type {any} */ (makeClient(fixtureCases));
  el.ownedCaseTypes = ['hello-review'];
  await el.connectedCallback();
  assert.equal(el._summaries[0].assigned, 2);
});

test('CROwnerSummary: completedToday count = completed cases with completedAt today', async () => {
  /** @type {import('../src/sharepoint-client.js').CaseRow[]} */
  const fixtureCases = [
    {
      id: 'c1',
      caseType: 'hello-review',
      title: 'C1',
      status: 'Completed',
      assignedReviewer: 'u',
      responsibleParty: 'rp',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: todayStart.toISOString(),
      etag: 'e1',
    },
    {
      id: 'c2',
      caseType: 'hello-review',
      title: 'C2',
      status: 'Completed',
      assignedReviewer: 'u',
      responsibleParty: 'rp',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: threeDaysAgo.toISOString(),
      etag: 'e2',
    },
  ];
  const el = new CROwnerSummary();
  el.client = /** @type {any} */ (makeClient(fixtureCases));
  el.ownedCaseTypes = ['hello-review'];
  await el.connectedCallback();
  assert.equal(el._summaries[0].completedToday, 1);
});

test('CROwnerSummary: completedLast7Days includes cases from within 7 days', async () => {
  /** @type {import('../src/sharepoint-client.js').CaseRow[]} */
  const fixtureCases = [
    {
      id: 'c1',
      caseType: 'hello-review',
      title: 'C1',
      status: 'Completed',
      assignedReviewer: 'u',
      responsibleParty: 'rp',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: todayStart.toISOString(),
      etag: 'e1',
    },
    {
      id: 'c2',
      caseType: 'hello-review',
      title: 'C2',
      status: 'Completed',
      assignedReviewer: 'u',
      responsibleParty: 'rp',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: threeDaysAgo.toISOString(),
      etag: 'e2',
    },
    {
      id: 'c3',
      caseType: 'hello-review',
      title: 'C3',
      status: 'Completed',
      assignedReviewer: 'u',
      responsibleParty: 'rp',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: tenDaysAgo.toISOString(),
      etag: 'e3',
    },
  ];
  const el = new CROwnerSummary();
  el.client = /** @type {any} */ (makeClient(fixtureCases));
  el.ownedCaseTypes = ['hello-review'];
  await el.connectedCallback();
  assert.equal(
    el._summaries[0].completedLast7Days,
    2,
    'today + 3 days ago, not 10 days ago'
  );
});

test('CROwnerSummary: overdue count = in-progress cases with dueDate in the past', async () => {
  const yesterday = new Date(
    todayStart.getTime() - 24 * 60 * 60 * 1000
  ).toISOString();
  const tomorrow = new Date(
    todayStart.getTime() + 24 * 60 * 60 * 1000
  ).toISOString();
  /** @type {import('../src/sharepoint-client.js').CaseRow[]} */
  const fixtureCases = [
    {
      id: 'c1',
      caseType: 'hello-review',
      title: 'C1',
      status: 'In-progress',
      assignedReviewer: 'u',
      responsibleParty: 'rp',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: null,
      dueDate: yesterday,
      etag: 'e1',
    },
    {
      id: 'c2',
      caseType: 'hello-review',
      title: 'C2',
      status: 'In-progress',
      assignedReviewer: 'u',
      responsibleParty: 'rp',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: null,
      dueDate: tomorrow,
      etag: 'e2',
    },
    {
      id: 'c3',
      caseType: 'hello-review',
      title: 'C3',
      status: 'In-progress',
      assignedReviewer: 'u',
      responsibleParty: 'rp',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: null,
      etag: 'e3',
    },
  ];
  const el = new CROwnerSummary();
  el.client = /** @type {any} */ (makeClient(fixtureCases));
  el.ownedCaseTypes = ['hello-review'];
  await el.connectedCallback();
  assert.equal(el._summaries[0].overdue, 1);
});

test('CROwnerSummary: renders heading and one card per owned case type', async () => {
  const el = new CROwnerSummary();
  el.client = /** @type {any} */ ({
    async listCases() {
      return [];
    },
  });
  el.ownedCaseTypes = ['hello-review', 'audit-review'];
  await el.connectedCallback();
  // _children: [h2, card-0, card-1]
  assert.equal(/** @type {any} */ (el)._children.length, 3);
});

test('CROwnerSummary: renders correct counts for hello-review fixture data', async () => {
  const { cases } = await import('../dev/fixtures/cases.js');
  const el = new CROwnerSummary();
  el.client = /** @type {any} */ ({
    async listCases(
      /** @type {import('../src/sharepoint-client.js').ListCasesFilter} */ filter
    ) {
      return cases
        .filter((c) => c.caseType === filter.caseType)
        .map((c) => ({ ...c }));
    },
  });
  el.ownedCaseTypes = ['hello-review'];
  await el.connectedCallback();

  const s = el._summaries[0];
  // case-1, case-2, case-3, case-10, case-11, case-12, case-13, rm-case-3, rm-case-4 are In-progress + assigned → assigned=9
  // case-4 and case-7 are In-progress + unassigned → outstanding=2
  // case-5, case-8 are Completed today → completedToday=2, completedLast7Days includes both
  // case-6, rm-case-1 are Completed within 7 days → completedLast7Days includes them → 4 total (rm-case-2 is 20d ago, out)
  // case-9 is Completed 2 months ago → outside 7-day window
  assert.equal(s.outstanding, 2, 'outstanding: 2 unassigned in-progress cases');
  assert.equal(s.assigned, 9, 'assigned: 9 assigned in-progress cases');
  assert.equal(s.completedToday, 2, 'completed today: 2');
  assert.equal(s.completedLast7Days, 4, 'completed last 7 days: 4');
});
