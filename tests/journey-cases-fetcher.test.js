// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { fetchJourneyCases } =
  await import('../src/services/journey-cases-fetcher.js');

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
  status: 'Completed',
  assignedReviewer: 'r',
  responsibleParty: 'rp',
  answers: {},
  conversation: [],
  notes: '',
  completedAt: null,
  etag: 'e',
});

test('fetchJourneyCases: one bounded $filter query per owned Case Type', async () => {
  const client = makeClient();
  await fetchJourneyCases(/** @type {any} */ (client), [
    'example-review',
    'complaints',
  ]);
  assert.equal(client.calls.length, 2);
  assert.ok(client.calls.some((c) => c.caseType === 'example-review'));
  assert.ok(client.calls.some((c) => c.caseType === 'complaints'));
});

test('fetchJourneyCases: scopes each query to its Case Type only', async () => {
  const client = makeClient();
  await fetchJourneyCases(/** @type {any} */ (client), ['complaints']);
  assert.equal(client.calls.length, 1);
  assert.deepEqual(Object.keys(client.calls[0]), ['caseType']);
  assert.equal(client.calls[0].caseType, 'complaints');
});

test('fetchJourneyCases: merges rows across owned Case Types', async () => {
  const client = makeClient({
    'example-review': [
      row('c1', 'example-review'),
      row('c2', 'example-review'),
    ],
    complaints: [row('c3', 'complaints')],
  });
  const result = await fetchJourneyCases(/** @type {any} */ (client), [
    'example-review',
    'complaints',
  ]);
  assert.equal(result.length, 3);
  assert.ok(result.some((c) => c.id === 'c1'));
  assert.ok(result.some((c) => c.id === 'c3'));
});

test('fetchJourneyCases: no owned types → no queries, empty result', async () => {
  const client = makeClient();
  const result = await fetchJourneyCases(/** @type {any} */ (client), []);
  assert.deepEqual(result, []);
  assert.equal(client.calls.length, 0);
});
