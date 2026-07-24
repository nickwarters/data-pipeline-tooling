// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { fetchTeamCases, fetchTeamWorkloadCases } =
  await import('../src/services/team-cases-fetcher.js');

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
    src('example-review'),
    src('product-sale-review'),
  ]);
  assert.equal(client.calls.length, 2);
  assert.ok(client.calls.some((c) => c.filter.caseType === 'example-review'));
  assert.ok(
    client.calls.some((c) => c.filter.caseType === 'product-sale-review')
  );
});

test('fetchTeamCases: queries only the specified caseType when set', async () => {
  const client = makeClient();
  const params = { ...baseParams(), caseType: 'example-review' };
  await fetchTeamCases(/** @type {any} */ (client), params, 'u1', [
    src('example-review'),
    src('product-sale-review'),
  ]);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].filter.caseType, 'example-review');
});

test('fetchTeamCases: passes assignedReviewerManager filter for role=reviewer-manager', async () => {
  const client = makeClient();
  await fetchTeamCases(/** @type {any} */ (client), baseParams(), 'mgr-99', [
    src('example-review'),
  ]);
  assert.equal(client.calls[0].filter.assignedReviewerManager, 'mgr-99');
});

test('fetchTeamCases: passes an explicit { listName } for every listCases call', async () => {
  const client = makeClient();
  await fetchTeamCases(/** @type {any} */ (client), baseParams(), 'u1', [
    src('example-review', 'ExampleReviews'),
    src('product-sale-review', 'ProductSaleReviews'),
  ]);
  assert.equal(client.calls.length, 2);
  assert.ok(
    client.calls.some((c) => c.opts?.listName === 'ExampleReviews'),
    'should pass listName for example-review'
  );
  assert.ok(
    client.calls.some((c) => c.opts?.listName === 'ProductSaleReviews'),
    'should pass listName for product-sale-review'
  );
});

test('fetchTeamCases: merges results from multiple case type lists', async () => {
  const client = makeClient({
    'example-review': [
      row('c1', 'example-review'),
      row('c2', 'example-review'),
    ],
    'product-sale-review': [row('c3', 'product-sale-review')],
  });
  const result = await fetchTeamCases(
    /** @type {any} */ (client),
    baseParams(),
    'u1',
    [src('example-review'), src('product-sale-review')]
  );
  assert.equal(result.length, 3);
  assert.ok(result.some((c) => c.id === 'c1'));
  assert.ok(result.some((c) => c.id === 'c3'));
});

test('fetchTeamCases: returns empty array and makes no calls when sources is empty', async () => {
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

test('fetchTeamCases: caseType matching no source yields no calls and empty result', async () => {
  const client = makeClient();
  const params = { ...baseParams(), caseType: 'nope' };
  const result = await fetchTeamCases(
    /** @type {any} */ (client),
    params,
    'u1',
    [src('example-review'), src('product-sale-review')]
  );
  assert.deepEqual(result, []);
  assert.equal(client.calls.length, 0);
});

test('fetchTeamWorkloadCases: reuses manager-scoped fan-out without Team Cases params', async () => {
  const client = makeClient({
    complaints: [row('c1', 'complaints')],
    conduct: [row('c2', 'conduct')],
  });
  const result = await fetchTeamWorkloadCases(
    /** @type {any} */ (client),
    'manager-1',
    [src('complaints'), src('conduct')]
  );

  assert.deepEqual(
    client.calls.map(({ filter, opts }) => ({
      filter,
      listName: opts?.listName,
    })),
    [
      {
        filter: {
          caseType: 'complaints',
          assignedReviewerManager: 'manager-1',
        },
        listName: 'complaints-list',
      },
      {
        filter: {
          caseType: 'conduct',
          assignedReviewerManager: 'manager-1',
        },
        listName: 'conduct-list',
      },
    ]
  );
  assert.deepEqual(
    result.map((item) => item.id),
    ['c1', 'c2']
  );
});
