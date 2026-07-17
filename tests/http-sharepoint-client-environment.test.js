// @ts-check
// Environment scoping of HttpSharePointClient (ADR-0033): a `listPrefix`
// applied centrally to every list URL, and an `exportBasePath` for the
// versioned Question Bank export reads. Kept separate from
// http-sharepoint-client.test.js so the environment surface is one file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';

const WEB_URL = 'https://sp.example.com/sites/casereview';

/**
 * Fake fetch capturing every call and answering with `respond(call)`.
 * @param {(call: { method: string, url: string }) => Response} respond
 */
function makeFetch(respond) {
  /** @type {{ method: string, url: string }[]} */
  const calls = [];
  return {
    calls,
    /** @type {(input: RequestInfo|URL, init?: RequestInit) => Promise<Response>} */
    async fetch(input, init = {}) {
      const call = {
        method: (init.method ?? 'GET').toUpperCase(),
        url: typeof input === 'string' ? input : input.toString(),
      };
      calls.push(call);
      return respond(call);
    },
  };
}

const itemJson = JSON.stringify({
  Id: 'c1',
  Title: 'T',
  Status: 'In-progress',
  CaseType: 'example-review',
  Answers: '{}',
  Conversation: '[]',
  Notes: '',
});

/** @param {string} body */
function ok(body) {
  return new Response(body, { status: 200, headers: { ETag: '"v1"' } });
}

function digestResponse() {
  return ok(JSON.stringify({ FormDigestValue: 'digest-1' }));
}

test('listPrefix: getCase targets the prefixed named Case list', async () => {
  const { fetch, calls } = makeFetch(() => ok(itemJson));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
    listPrefix: 'uat_',
  });

  await client.getCase('c1', { listName: 'Cases-ExampleReview' });

  assert.match(calls[0].url, /getbytitle\('uat_Cases-ExampleReview'\)/);
});

test('listPrefix: per-Case-Type opts.listName overrides are prefixed too', async () => {
  const { fetch, calls } = makeFetch(() => ok(itemJson));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
    listPrefix: 'uat_',
  });

  await client.getCase('c1', { listName: 'complaints' });

  assert.match(calls[0].url, /getbytitle\('uat_complaints'\)/);
});

test('listPrefix: listCases and countCases are prefixed', async () => {
  const { fetch, calls } = makeFetch((call) =>
    call.url.endsWith('/$count') ? ok('0') : ok(JSON.stringify({ value: [] }))
  );
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
    listPrefix: 'uat_',
  });

  await client.listCases({}, { listName: 'Cases-ExampleReview' });
  await client.countCases({}, { listName: 'complaints' });

  assert.match(calls[0].url, /getbytitle\('uat_Cases-ExampleReview'\)/);
  assert.match(calls[1].url, /getbytitle\('uat_complaints'\)/);
});

test('listPrefix: patchCase writes to the prefixed list', async () => {
  const { fetch, calls } = makeFetch((call) =>
    call.url.endsWith('/_api/contextinfo') ? digestResponse() : ok(itemJson)
  );
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
    listPrefix: 'uat_',
  });

  await client.patchCase('c1', { notes: 'n' }, '"v1"', {
    listName: 'Cases-ExampleReview',
  });

  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch);
  assert.match(patch.url, /getbytitle\('uat_Cases-ExampleReview'\)/);
});

test('listPrefix: defaults to empty — prod URLs are unchanged', async () => {
  const { fetch, calls } = makeFetch(() => ok(itemJson));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.getCase('c1', { listName: 'Cases-ExampleReview' });

  assert.match(calls[0].url, /getbytitle\('Cases-ExampleReview'\)/);
});

test('exportBasePath: getExportHash and getVersionedExport read the scoped path', async () => {
  const { fetch, calls } = makeFetch(() =>
    ok(JSON.stringify({ hash: 'abc123' }))
  );
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
    exportBasePath: '/Style%20Library/case-review-uat/case-types',
  });

  assert.equal(await client.getExportHash('example-review'), 'abc123');
  await client.getVersionedExport('example-review', 'abc123');

  assert.equal(
    calls[0].url,
    `${WEB_URL}/Style%20Library/case-review-uat/case-types/example-review.json`
  );
  assert.equal(
    calls[1].url,
    `${WEB_URL}/Style%20Library/case-review-uat/case-types/example-review.abc123.json`
  );
});

test('exportBasePath: defaults to the prod Style Library path', async () => {
  const { fetch, calls } = makeFetch(() => ok(JSON.stringify({ hash: 'h' })));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.getExportHash('example-review');

  assert.equal(
    calls[0].url,
    `${WEB_URL}/Style%20Library/case-review/case-types/example-review.json`
  );
});
