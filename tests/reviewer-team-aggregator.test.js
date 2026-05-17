// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { aggregateReviewerTeamData } = await import('../src/evaluators/reviewer-team-aggregator.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

const NOW = new Date(2026, 4, 17, 15, 0, 0); // May 17 2026
// sevenDaysAgo = May 11 00:00 local
// thirtyDaysAgo = Apr 18 00:00 local

/** @type {import('../src/evaluators/time-windows.js').TimeWindows} */
const WINDOWS = {
  sevenDaysAgo: new Date(2026, 4, 11, 0, 0, 0),
  thirtyDaysAgo: new Date(2026, 3, 18, 0, 0, 0),
};

/** @param {Partial<CaseRow>} overrides @returns {CaseRow} */
function makeCase(overrides) {
  return {
    id: 'c1',
    caseType: 'hello-review',
    title: 'Test Case',
    status: 'In-progress',
    assignedReviewer: 'user-rev',
    responsibleParty: 'user-rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'etag-1',
    ...overrides,
  };
}

test('aggregateReviewerTeamData: case completed within 7-day window counts in completedLast7d', () => {
  const cases = [
    makeCase({ id: 'c1', status: 'Completed', completedAt: new Date(2026, 4, 14, 10, 0, 0).toISOString() }), // May 14, within 7d
  ];
  const result = aggregateReviewerTeamData(cases, WINDOWS);
  assert.equal(result.completedLast7d, 1);
});

test('aggregateReviewerTeamData: case completed within 30-day but outside 7-day window counts in completedLast30d', () => {
  const cases = [
    makeCase({ id: 'c2', status: 'Completed', completedAt: new Date(2026, 3, 25, 10, 0, 0).toISOString() }), // Apr 25, in 30d not 7d
  ];
  const result = aggregateReviewerTeamData(cases, WINDOWS);
  assert.equal(result.completedLast30d, 1);
  assert.equal(result.completedLast7d, 0);
});

test('aggregateReviewerTeamData: in-progress non-overdue case counts as outstanding', () => {
  const nextWeek = new Date(2026, 4, 24, 0, 0, 0).toISOString();
  const cases = [
    makeCase({ id: 'c3', status: 'In-progress', dueDate: nextWeek }),
  ];
  const result = aggregateReviewerTeamData(cases, WINDOWS);
  assert.equal(result.outstanding, 1);
  assert.equal(result.overdue, 0);
});

test('aggregateReviewerTeamData: in-progress case past dueDate counts as overdue', () => {
  const yesterday = new Date(2026, 4, 16, 0, 0, 0).toISOString();
  const cases = [
    makeCase({ id: 'c4', status: 'In-progress', dueDate: yesterday }),
  ];
  const result = aggregateReviewerTeamData(cases, WINDOWS);
  assert.equal(result.overdue, 1);
  assert.equal(result.outstanding, 0);
});

test('aggregateReviewerTeamData: byType groups counts per caseType slug', () => {
  const cases = [
    makeCase({ id: 'c5', caseType: 'hello-review', status: 'Completed', completedAt: new Date(2026, 4, 14).toISOString() }),
    makeCase({ id: 'c6', caseType: 'product-sale-review', status: 'In-progress', dueDate: new Date(2026, 4, 24).toISOString() }),
  ];
  const result = aggregateReviewerTeamData(cases, WINDOWS);
  assert.ok(result.byType['hello-review'], 'should have hello-review entry');
  assert.equal(result.byType['hello-review'].completedLast7d, 1);
  assert.ok(result.byType['product-sale-review'], 'should have product-sale-review entry');
  assert.equal(result.byType['product-sale-review'].outstanding, 1);
});

test('aggregateReviewerTeamData: empty case list returns all zeros', () => {
  const result = aggregateReviewerTeamData([], WINDOWS);
  assert.equal(result.completedLast7d, 0);
  assert.equal(result.completedLast30d, 0);
  assert.equal(result.outstanding, 0);
  assert.equal(result.overdue, 0);
  assert.deepEqual(result.byType, {});
});
