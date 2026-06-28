// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { fetchReviewerTeamCases } =
  await import('../src/services/reviewer-team-fetcher.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').ListCasesFilter} ListCasesFilter */

/** Minimal mock client that records listCases calls */
/** @param {Record<string, CaseRow[]>} [casesByType] */
function makeClient(casesByType = {}) {
  const calls = /** @type {ListCasesFilter[]} */ ([]);
  return {
    calls,
    /** @type {import('../src/sharepoint-client.js').SharePointClient['listCases']} */
    async listCases(filter) {
      calls.push({ ...filter });
      return (casesByType[filter.caseType ?? ''] ?? []).map(
        /** @param {CaseRow} c */ (c) => ({ ...c })
      );
    },
  };
}

test('fetchReviewerTeamCases: calls listCases once per eligible case type with assignedReviewerManager filter', async () => {
  const client = makeClient();
  await fetchReviewerTeamCases(/** @type {any} */ (client), 'user-rm', [
    'example-review',
    'product-sale-review',
  ]);
  assert.equal(client.calls.length, 2, 'should make one call per case type');
  assert.ok(
    client.calls.every((c) => c.assignedReviewerManager === 'user-rm'),
    'all calls should filter by managerId'
  );
  assert.ok(
    client.calls.some((c) => c.caseType === 'example-review'),
    'should query example-review'
  );
  assert.ok(
    client.calls.some((c) => c.caseType === 'product-sale-review'),
    'should query product-sale-review'
  );
});

test('fetchReviewerTeamCases: merges results from all case types into one array', async () => {
  /** @param {string} id @param {string} caseType @returns {CaseRow} */
  const makeRow = (id, caseType) => ({
    id,
    caseType,
    title: 'T',
    status: 'In-progress',
    assignedReviewer: 'r',
    responsibleParty: 'rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'e',
  });
  const client = makeClient({
    'example-review': [
      makeRow('c1', 'example-review'),
      makeRow('c2', 'example-review'),
    ],
    'product-sale-review': [makeRow('c3', 'product-sale-review')],
  });
  const result = await fetchReviewerTeamCases(
    /** @type {any} */ (client),
    'user-rm',
    ['example-review', 'product-sale-review']
  );
  assert.equal(result.length, 3, 'should return all cases from all types');
  assert.ok(result.some((c) => c.id === 'c1'));
  assert.ok(result.some((c) => c.id === 'c3'));
});

test('fetchReviewerTeamCases: returns empty array when no eligible case types', async () => {
  const client = makeClient();
  const result = await fetchReviewerTeamCases(
    /** @type {any} */ (client),
    'user-rm',
    []
  );
  assert.deepEqual(result, []);
  assert.equal(client.calls.length, 0);
});
