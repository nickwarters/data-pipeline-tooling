// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

// ===== IMPORTS (after stubs) =====
const { CORAOwnerSummary } =
  await import('../src/components/cora-owner-summary.js');

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

test('CORAOwnerSummary: connectedCallback does nothing when ownedCaseTypes is empty', async () => {
  const el = new CORAOwnerSummary();
  el.client = /** @type {any} */ (makeClient([]));
  el.ownedCaseTypes = [];
  await el.connectedCallback();
  assert.equal(/** @type {any} */ (el)._children.length, 0);
});

test('CORAOwnerSummary: connectedCallback does nothing when client is null', async () => {
  const el = new CORAOwnerSummary();
  el.client = null;
  el.ownedCaseTypes = ['example-review'];
  await el.connectedCallback();
  assert.equal(/** @type {any} */ (el)._children.length, 0);
});

test('CORAOwnerSummary: calls listCases with caseType filter for each owned type', async () => {
  /** @type {import('../src/sharepoint-client.js').ListCasesFilter[]} */
  const calls = [];
  const el = new CORAOwnerSummary();
  el.client = /** @type {any} */ ({
    async listCases(
      /** @type {import('../src/sharepoint-client.js').ListCasesFilter} */ f
    ) {
      calls.push(f);
      return [];
    },
  });
  el.ownedCaseTypes = ['example-review', 'audit-review'];
  await el.connectedCallback();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { caseType: 'example-review' });
  assert.deepEqual(calls[1], { caseType: 'audit-review' });
});

test('CORAOwnerSummary: stores summaries on _summaries after _refresh', async () => {
  const el = new CORAOwnerSummary();
  el.client = /** @type {any} */ (makeClient([]));
  el.ownedCaseTypes = ['example-review'];
  await el.connectedCallback();
  assert.ok(Array.isArray(el._summaries), '_summaries should be set');
  assert.equal(el._summaries.length, 1);
  assert.equal(el._summaries[0].caseType, 'example-review');
});

test('CORAOwnerSummary: outstanding count = unassigned in-progress cases', async () => {
  /** @type {import('../src/sharepoint-client.js').CaseRow[]} */
  const fixtureCases = [
    {
      id: 'c1',
      caseType: 'example-review',
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
      caseType: 'example-review',
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
  const el = new CORAOwnerSummary();
  el.client = /** @type {any} */ (makeClient(fixtureCases));
  el.ownedCaseTypes = ['example-review'];
  await el.connectedCallback();
  assert.equal(el._summaries[0].outstanding, 1);
});

test('CORAOwnerSummary: assigned count = in-progress cases with an assigned reviewer', async () => {
  /** @type {import('../src/sharepoint-client.js').CaseRow[]} */
  const fixtureCases = [
    {
      id: 'c1',
      caseType: 'example-review',
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
      caseType: 'example-review',
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
      caseType: 'example-review',
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
  const el = new CORAOwnerSummary();
  el.client = /** @type {any} */ (makeClient(fixtureCases));
  el.ownedCaseTypes = ['example-review'];
  await el.connectedCallback();
  assert.equal(el._summaries[0].assigned, 2);
});

test('CORAOwnerSummary: completedToday count = completed cases with completedAt today', async () => {
  /** @type {import('../src/sharepoint-client.js').CaseRow[]} */
  const fixtureCases = [
    {
      id: 'c1',
      caseType: 'example-review',
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
      caseType: 'example-review',
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
  const el = new CORAOwnerSummary();
  el.client = /** @type {any} */ (makeClient(fixtureCases));
  el.ownedCaseTypes = ['example-review'];
  await el.connectedCallback();
  assert.equal(el._summaries[0].completedToday, 1);
});

test('CORAOwnerSummary: completedLast7Days includes cases from within 7 days', async () => {
  /** @type {import('../src/sharepoint-client.js').CaseRow[]} */
  const fixtureCases = [
    {
      id: 'c1',
      caseType: 'example-review',
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
      caseType: 'example-review',
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
      caseType: 'example-review',
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
  const el = new CORAOwnerSummary();
  el.client = /** @type {any} */ (makeClient(fixtureCases));
  el.ownedCaseTypes = ['example-review'];
  await el.connectedCallback();
  assert.equal(
    el._summaries[0].completedLast7Days,
    2,
    'today + 3 days ago, not 10 days ago'
  );
});

test('CORAOwnerSummary: overdue count = in-progress cases with dueDate in the past', async () => {
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
      caseType: 'example-review',
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
      caseType: 'example-review',
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
      caseType: 'example-review',
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
  const el = new CORAOwnerSummary();
  el.client = /** @type {any} */ (makeClient(fixtureCases));
  el.ownedCaseTypes = ['example-review'];
  await el.connectedCallback();
  assert.equal(el._summaries[0].overdue, 1);
});

test('CORAOwnerSummary: renders heading and one card per owned case type', async () => {
  const el = new CORAOwnerSummary();
  el.client = /** @type {any} */ ({
    async listCases() {
      return [];
    },
  });
  el.ownedCaseTypes = ['example-review', 'audit-review'];
  await el.connectedCallback();
  // _children: [h2, card-0, card-1]
  assert.equal(/** @type {any} */ (el)._children.length, 3);
});

test('CORAOwnerSummary: renders correct counts for example-review fixture data', async () => {
  const { cases } = await import('../dev/fixtures/cases.js');
  const el = new CORAOwnerSummary();
  el.client = /** @type {any} */ ({
    async listCases(
      /** @type {import('../src/sharepoint-client.js').ListCasesFilter} */ filter
    ) {
      return cases
        .filter((c) => c.caseType === filter.caseType)
        .map((c) => ({ ...c }));
    },
  });
  el.ownedCaseTypes = ['example-review'];
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
