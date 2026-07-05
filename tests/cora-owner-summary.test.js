// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

// ===== IMPORTS (after stubs) =====
const { CORAOwnerSummary } =
  await import('../src/components/sections/cora-owner-summary.js');

// ===== HELPERS =====
const now = new Date();
const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const sevenDaysAgo = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
const threeDaysAgo = new Date(todayStart.getTime() - 3 * 24 * 60 * 60 * 1000);
const tenDaysAgo = new Date(todayStart.getTime() - 10 * 24 * 60 * 60 * 1000);

/**
 * A filter-honouring stand-in for a SharePointClient. `listCases` and
 * `countCases` apply the same server-side predicate the real clients do for the
 * fields the summary leads with: caseType, status, and the CompletedAt window.
 *
 * @param {import('../src/sharepoint-client.js').CaseRow[]} allCases
 */
function makeClient(allCases) {
  /** @param {import('../src/sharepoint-client.js').ListCasesFilter} f */
  const predicate =
    (f) => (/** @type {import('../src/sharepoint-client.js').CaseRow} */ c) => {
      if (f.caseType !== undefined && c.caseType !== f.caseType) return false;
      if (f.status !== undefined && c.status !== f.status) return false;
      if (f.completedAfter !== undefined) {
        if (!c.completedAt || c.completedAt < f.completedAfter) return false;
      }
      if (f.completedBefore !== undefined) {
        if (!c.completedAt || c.completedAt >= f.completedBefore) return false;
      }
      return true;
    };
  return {
    /** @param {import('../src/sharepoint-client.js').ListCasesFilter} f */
    async listCases(f) {
      return allCases.filter(predicate(f)).map((c) => ({ ...c }));
    },
    /** @param {import('../src/sharepoint-client.js').ListCasesFilter} f */
    async countCases(f) {
      return allCases.filter(predicate(f)).length;
    },
  };
}

/**
 * @param {Partial<import('../src/sharepoint-client.js').CaseRow>} over
 * @returns {import('../src/sharepoint-client.js').CaseRow}
 */
function caseRow(over) {
  return /** @type {import('../src/sharepoint-client.js').CaseRow} */ ({
    id: 'c',
    caseType: 'example-review',
    title: 'C',
    status: 'In-progress',
    assignedReviewer: '',
    responsibleParty: 'rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'e',
    ...over,
  });
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

test('CORAOwnerSummary: leads with an In-progress, per-Case-Type listCases (no whole-type fetch)', async () => {
  /** @type {import('../src/sharepoint-client.js').ListCasesFilter[]} */
  const listCalls = [];
  const el = new CORAOwnerSummary();
  el.client = /** @type {any} */ ({
    async listCases(
      /** @type {import('../src/sharepoint-client.js').ListCasesFilter} */ f
    ) {
      listCalls.push(f);
      return [];
    },
    async countCases() {
      return 0;
    },
  });
  el.ownedCaseTypes = ['example-review', 'audit-review'];
  await el.connectedCallback();
  assert.equal(listCalls.length, 2);
  assert.deepEqual(listCalls[0], {
    caseType: 'example-review',
    status: 'In-progress',
  });
  assert.deepEqual(listCalls[1], {
    caseType: 'audit-review',
    status: 'In-progress',
  });
});

test('CORAOwnerSummary: completed metrics come from bounded CompletedAt-window counts (ADR-0031)', async () => {
  /** @type {import('../src/sharepoint-client.js').ListCasesFilter[]} */
  const countCalls = [];
  const el = new CORAOwnerSummary();
  el.client = /** @type {any} */ ({
    async listCases() {
      return [];
    },
    async countCases(
      /** @type {import('../src/sharepoint-client.js').ListCasesFilter} */ f
    ) {
      countCalls.push(f);
      return 0;
    },
  });
  el.ownedCaseTypes = ['example-review'];
  await el.connectedCallback();

  // 8 per-day slices (today + 7 prior days), each a bounded Completed window.
  assert.equal(countCalls.length, 8);
  for (const f of countCalls) {
    assert.equal(f.caseType, 'example-review');
    assert.equal(f.status, 'Completed');
    assert.ok(f.completedAfter, 'every slice bounds CompletedAt from below');
    assert.ok(f.completedBefore, 'every slice bounds CompletedAt from above');
  }
  // Slices are adjacent (each slice's upper bound is the next slice's lower
  // bound) and cover exactly [todayStart - 7 days, now].
  assert.equal(countCalls[0].completedAfter, todayStart.toISOString());
  assert.equal(countCalls[7].completedAfter, sevenDaysAgo.toISOString());
  for (let k = 1; k < countCalls.length; k++) {
    assert.equal(
      countCalls[k].completedBefore,
      countCalls[k - 1].completedAfter,
      'slice upper bound meets the previous slice lower bound'
    );
  }
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
  const fixtureCases = [
    caseRow({ id: 'c1', assignedReviewer: '' }),
    caseRow({ id: 'c2', assignedReviewer: 'user-x' }),
  ];
  const el = new CORAOwnerSummary();
  el.client = /** @type {any} */ (makeClient(fixtureCases));
  el.ownedCaseTypes = ['example-review'];
  await el.connectedCallback();
  assert.equal(el._summaries[0].outstanding, 1);
});

test('CORAOwnerSummary: assigned count = in-progress cases with an assigned reviewer', async () => {
  const fixtureCases = [
    caseRow({ id: 'c1', assignedReviewer: '' }),
    caseRow({ id: 'c2', assignedReviewer: 'user-x' }),
    caseRow({ id: 'c3', assignedReviewer: 'user-y' }),
  ];
  const el = new CORAOwnerSummary();
  el.client = /** @type {any} */ (makeClient(fixtureCases));
  el.ownedCaseTypes = ['example-review'];
  await el.connectedCallback();
  assert.equal(el._summaries[0].assigned, 2);
});

test('CORAOwnerSummary: completedToday count = completed cases with completedAt today', async () => {
  const fixtureCases = [
    caseRow({
      id: 'c1',
      status: 'Completed',
      assignedReviewer: 'u',
      completedAt: todayStart.toISOString(),
    }),
    caseRow({
      id: 'c2',
      status: 'Completed',
      assignedReviewer: 'u',
      completedAt: threeDaysAgo.toISOString(),
    }),
  ];
  const el = new CORAOwnerSummary();
  el.client = /** @type {any} */ (makeClient(fixtureCases));
  el.ownedCaseTypes = ['example-review'];
  await el.connectedCallback();
  assert.equal(el._summaries[0].completedToday, 1);
});

test('CORAOwnerSummary: completedLast7Days sums the per-day slices within 7 days', async () => {
  const fixtureCases = [
    caseRow({
      id: 'c1',
      status: 'Completed',
      assignedReviewer: 'u',
      completedAt: todayStart.toISOString(),
    }),
    caseRow({
      id: 'c2',
      status: 'Completed',
      assignedReviewer: 'u',
      completedAt: threeDaysAgo.toISOString(),
    }),
    caseRow({
      id: 'c3',
      status: 'Completed',
      assignedReviewer: 'u',
      completedAt: tenDaysAgo.toISOString(),
    }),
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
  const fixtureCases = [
    caseRow({ id: 'c1', assignedReviewer: 'u', dueDate: yesterday }),
    caseRow({ id: 'c2', assignedReviewer: 'u', dueDate: tomorrow }),
    caseRow({ id: 'c3', assignedReviewer: 'u' }),
  ];
  const el = new CORAOwnerSummary();
  el.client = /** @type {any} */ (makeClient(fixtureCases));
  el.ownedCaseTypes = ['example-review'];
  await el.connectedCallback();
  assert.equal(el._summaries[0].overdue, 1);
});

test('CORAOwnerSummary: renders heading and one card per owned case type', async () => {
  const el = new CORAOwnerSummary();
  el.client = /** @type {any} */ (makeClient([]));
  el.ownedCaseTypes = ['example-review', 'audit-review'];
  await el.connectedCallback();
  // _children: [h2, card-0, card-1]
  assert.equal(/** @type {any} */ (el)._children.length, 3);
});

test('CORAOwnerSummary: renders correct counts for example-review fixture data', async () => {
  const { cases } = await import('../dev/fixtures/cases.js');
  const el = new CORAOwnerSummary();
  el.client = /** @type {any} */ (makeClient(cases));
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
