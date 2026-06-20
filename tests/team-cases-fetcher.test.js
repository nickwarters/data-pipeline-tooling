// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { fetchTeamCases } =
  await import('../src/services/team-cases-fetcher.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').ListCasesFilter} ListCasesFilter */

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

/** @param {string} id @param {string} caseType @returns {CaseRow} */
const row = (id, caseType) => ({
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

/** @returns {import('../src/services/team-cases-params.js').TeamCasesParams} */
const baseParams = () => ({
  manager: 'me',
  role: 'reviewer-manager',
  caseType: null,
  status: null,
  completedSince: null,
  completedUntil: null,
});

test('fetchTeamCases: fans out to all eligible case types when caseType is null', async () => {
  const client = makeClient();
  await fetchTeamCases(/** @type {any} */ (client), baseParams(), 'u1', [
    'hello-review',
    'product-sale-review',
  ]);
  assert.equal(client.calls.length, 2);
  assert.ok(client.calls.some((c) => c.caseType === 'hello-review'));
  assert.ok(client.calls.some((c) => c.caseType === 'product-sale-review'));
});

test('fetchTeamCases: queries only the specified caseType when set', async () => {
  const client = makeClient();
  const params = { ...baseParams(), caseType: 'hello-review' };
  await fetchTeamCases(/** @type {any} */ (client), params, 'u1', [
    'hello-review',
    'product-sale-review',
  ]);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].caseType, 'hello-review');
});

test('fetchTeamCases: passes assignedReviewerManager filter for role=reviewer-manager', async () => {
  const client = makeClient();
  await fetchTeamCases(/** @type {any} */ (client), baseParams(), 'mgr-99', [
    'hello-review',
  ]);
  assert.equal(client.calls[0].assignedReviewerManager, 'mgr-99');
});

test('fetchTeamCases: merges results from multiple case type lists', async () => {
  const client = makeClient({
    'hello-review': [row('c1', 'hello-review'), row('c2', 'hello-review')],
    'product-sale-review': [row('c3', 'product-sale-review')],
  });
  const result = await fetchTeamCases(
    /** @type {any} */ (client),
    baseParams(),
    'u1',
    ['hello-review', 'product-sale-review']
  );
  assert.equal(result.length, 3);
  assert.ok(result.some((c) => c.id === 'c1'));
  assert.ok(result.some((c) => c.id === 'c3'));
});

test('fetchTeamCases: returns empty array and makes no calls when eligibleCaseTypes is empty', async () => {
  const client = makeClient();
  const result = await fetchTeamCases(
    /** @type {any} */ (client),
    baseParams(),
    'u1',
    []
  );
  assert.deepEqual(result, []);
  assert.equal(client.calls.length, 0);
});
