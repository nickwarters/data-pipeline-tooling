// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCaseRow } from './helpers/fixtures.js';

const { fetchJourneyCases } =
  await import('../src/services/journey-cases-fetcher.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').ListCasesFilter} ListCasesFilter */
/** @typedef {import('../src/sharepoint-client.js').CaseListOptions} CaseListOptions */

/** @param {Record<string, CaseRow[]>} [casesByType] */
function makeClient(casesByType = {}) {
  const calls =
    /** @type {{ filter: ListCasesFilter, opts: CaseListOptions | undefined }[]} */ ([]);
  return {
    calls,
    /** @type {import('../src/sharepoint-client.js').SharePointClient['listCases']} */
    async listCases(filter, opts) {
      calls.push({ filter: { ...filter }, opts: opts ? { ...opts } : opts });
      return (casesByType[filter.caseType ?? ''] ?? []).map(
        /** @param {CaseRow} c */ (c) => ({ ...c })
      );
    },
  };
}

/** @param {string} id @param {string} caseType @returns {CaseRow} */
const row = (id, caseType) =>
  makeCaseRow({
    id,
    caseType,
    title: 'T',
    status: 'Completed',
    assignedReviewer: 'r',
    responsibleParty: 'rp',
    etag: 'e',
  });

/**
 * @param {string} slug
 * @param {string} [listName]
 * @returns {import('../src/setup/resolve-eligible-case-types.js').CaseSource}
 */
const src = (slug, listName = `${slug}-list`) => ({
  slug,
  listName,
  displayName: slug,
});

test('fetchJourneyCases: one bounded $filter query per owned Case Type', async () => {
  const client = makeClient();
  await fetchJourneyCases(/** @type {any} */ (client), [
    src('example-review'),
    src('complaints'),
  ]);
  assert.equal(client.calls.length, 2);
  assert.ok(client.calls.some((c) => c.filter.caseType === 'example-review'));
  assert.ok(client.calls.some((c) => c.filter.caseType === 'complaints'));
});

test('fetchJourneyCases: scopes each query to its Case Type and list only', async () => {
  const client = makeClient();
  await fetchJourneyCases(/** @type {any} */ (client), [
    src('complaints', 'Complaints'),
  ]);
  assert.equal(client.calls.length, 1);
  assert.deepEqual(Object.keys(client.calls[0].filter), ['caseType']);
  assert.equal(client.calls[0].filter.caseType, 'complaints');
  assert.equal(client.calls[0].opts?.listName, 'Complaints');
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
    src('example-review'),
    src('complaints'),
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
