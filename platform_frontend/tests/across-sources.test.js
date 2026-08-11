// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCaseRow } from './helpers/fixtures.js';

const { listCasesPerSource, listCasesAcrossSources, countCasesAcrossSources } =
  await import('../src/services/across-sources.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').ListCasesFilter} ListCasesFilter */
/** @typedef {import('../src/sharepoint-client.js').CaseListOptions} CaseListOptions */
/** @typedef {import('../src/sharepoint-client.js').SharePointClient} SharePointClient */

/** @param {string} id @param {string} caseType @returns {CaseRow} */
const row = (id, caseType) =>
  makeCaseRow({
    id,
    caseType,
    title: 'T',
    assignedReviewer: 'r',
    responsibleParty: 'rp',
    etag: 'e',
  });

/**
 * @param {string} slug
 * @param {string} [listName]
 */
const source = (slug, listName = `${slug} Cases`) => ({
  slug,
  listName,
  displayName: slug,
});

/**
 * @param {Record<string, CaseRow[]>} rowsByList
 * @param {Record<string, number>} [countsByList]
 */
function makeClient(rowsByList, countsByList = {}) {
  const listCalls =
    /** @type {{ filter: ListCasesFilter, opts: CaseListOptions | undefined }[]} */ ([]);
  const countCalls =
    /** @type {{ filter: ListCasesFilter, opts: CaseListOptions | undefined }[]} */ ([]);
  const client = /** @type {SharePointClient} */ (
    /** @type {unknown} */ ({
      /** @type {SharePointClient['listCases']} */
      async listCases(filter, opts) {
        listCalls.push({
          filter: { ...filter },
          opts: opts ? { ...opts } : opts,
        });
        return rowsByList[opts?.listName ?? ''] ?? [];
      },
      /** @type {SharePointClient['countCases']} */
      async countCases(filter, opts) {
        countCalls.push({
          filter: { ...filter },
          opts: opts ? { ...opts } : opts,
        });
        return countsByList[opts?.listName ?? ''] ?? 0;
      },
    })
  );
  return { client, listCalls, countCalls };
}

test('listCasesPerSource fans out one scoped call per source and pairs rows with their source', async () => {
  const alpha = source('alpha');
  const beta = source('beta');
  const { client, listCalls } = makeClient({
    'alpha Cases': [row('a1', 'alpha')],
    'beta Cases': [row('b1', 'beta'), row('b2', 'beta')],
  });

  const pairs = await listCasesPerSource(client, [alpha, beta], {
    status: 'In-progress',
  });

  assert.equal(listCalls.length, 2);
  assert.deepEqual(listCalls[0].filter, { status: 'In-progress' });
  assert.deepEqual(listCalls[0].opts, { listName: 'alpha Cases' });
  assert.deepEqual(listCalls[1].opts, { listName: 'beta Cases' });
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].source, alpha);
  assert.deepEqual(
    pairs[0].rows.map((r) => r.id),
    ['a1']
  );
  assert.equal(pairs[1].source, beta);
  assert.deepEqual(
    pairs[1].rows.map((r) => r.id),
    ['b1', 'b2']
  );
});

test('listCasesPerSource accepts a per-source filter function', async () => {
  const { client, listCalls } = makeClient({});

  await listCasesPerSource(client, [source('alpha'), source('beta')], (s) => ({
    titlePrefix: s.slug,
  }));

  assert.deepEqual(listCalls[0].filter, { titlePrefix: 'alpha' });
  assert.deepEqual(listCalls[1].filter, { titlePrefix: 'beta' });
});

test('listCasesPerSource merges extra list options under the per-source listName', async () => {
  const { client, listCalls } = makeClient({});

  await listCasesPerSource(
    client,
    [source('alpha')],
    {},
    {
      top: 5,
      orderBy: 'dueDate',
      orderDir: 'asc',
    }
  );

  assert.deepEqual(listCalls[0].opts, {
    top: 5,
    orderBy: 'dueDate',
    orderDir: 'asc',
    listName: 'alpha Cases',
  });
});

test('listCasesAcrossSources flattens per-source rows in source order', async () => {
  const { client } = makeClient({
    'alpha Cases': [row('a1', 'alpha')],
    'beta Cases': [row('b1', 'beta')],
  });

  const rows = await listCasesAcrossSources(
    client,
    [source('alpha'), source('beta')],
    { status: 'In-progress' }
  );

  assert.deepEqual(
    rows.map((r) => r.id),
    ['a1', 'b1']
  );
});

test('listCasesAcrossSources with no sources resolves empty without calling the client', async () => {
  const { client, listCalls } = makeClient({});

  assert.deepEqual(await listCasesAcrossSources(client, [], {}), []);
  assert.equal(listCalls.length, 0);
});

test('listCasesAcrossSources fails as a unit when any per-source read rejects', async () => {
  const client = /** @type {SharePointClient} */ (
    /** @type {unknown} */ ({
      /** @type {SharePointClient['listCases']} */
      async listCases(_filter, opts) {
        if (opts?.listName === 'beta Cases') throw new Error('403');
        return [];
      },
    })
  );

  await assert.rejects(
    listCasesAcrossSources(client, [source('alpha'), source('beta')], {}),
    /403/
  );
});

test('countCasesAcrossSources sums one scoped count per source', async () => {
  const { client, countCalls } = makeClient(
    {},
    { 'alpha Cases': 2, 'beta Cases': 3 }
  );

  const total = await countCasesAcrossSources(
    client,
    [source('alpha'), source('beta')],
    { hasOpenAppeal: true }
  );

  assert.equal(total, 5);
  assert.equal(countCalls.length, 2);
  assert.deepEqual(countCalls[0].filter, { hasOpenAppeal: true });
  assert.deepEqual(countCalls[0].opts, { listName: 'alpha Cases' });
  assert.deepEqual(countCalls[1].opts, { listName: 'beta Cases' });
});

test('countCasesAcrossSources accepts a per-source filter function and sums zero sources to 0', async () => {
  const { client, countCalls } = makeClient({}, { 'alpha Cases': 4 });

  const total = await countCasesAcrossSources(
    client,
    [source('alpha')],
    (s) => ({
      titlePrefix: s.slug,
    })
  );

  assert.equal(total, 4);
  assert.deepEqual(countCalls[0].filter, { titlePrefix: 'alpha' });
  assert.equal(await countCasesAcrossSources(client, [], {}), 0);
});

test('countCasesAcrossSources fails as a unit when any per-source count rejects', async () => {
  const client = /** @type {SharePointClient} */ (
    /** @type {unknown} */ ({
      /** @type {SharePointClient['countCases']} */
      async countCases(_filter, opts) {
        if (opts?.listName === 'beta Cases') throw new Error('403');
        return 1;
      },
    })
  );

  await assert.rejects(
    countCasesAcrossSources(client, [source('alpha'), source('beta')], {}),
    /403/
  );
});
