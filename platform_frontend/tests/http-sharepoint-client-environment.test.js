// @ts-check
// Environment scoping of HttpSharePointClient: a `listPrefix` applied centrally
// to every list URL. Kept separate from http-sharepoint-client.test.js so the
// environment surface is one file.
//
// Question Bank artifact reads are here too, because they used to be the second
// half of that surface — a per-environment Style Library base path — and are
// now scoped by where the app was deployed instead. These tests are what says
// that is deliberate.
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

test('Question Bank artifacts are read from the deployed banks folder, not a declared path', async () => {
  // The artifacts sit beside the app that reads them, so the URL is derived
  // from the module's own location rather than from an environment setting.
  // That is what makes a UAT deploy read UAT's artifacts without being told
  // which environment it is.
  const { fetch, calls } = makeFetch(() =>
    ok(JSON.stringify({ slug: 'example-review', questions: [] }))
  );
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.getBankVersion('example-review');
  await client.getVersionedExport('example-review', 'abc123');

  assert.ok(
    calls[0].url.endsWith('/case-types/banks/example-review.txt'),
    `expected the bank artifact, got ${calls[0].url}`
  );
  assert.ok(
    calls[1].url.endsWith('/case-types/banks/example-review.abc123.txt'),
    `expected the versioned artifact, got ${calls[1].url}`
  );
  // The web URL is not involved: these are not list reads.
  assert.equal(calls[0].url.startsWith(WEB_URL), false);
});

test('a missing or unreadable artifact reads as "not published", never a throw', async () => {
  // Both reads are how a Case decides what questions it was reviewed with, and
  // neither may break the Case: a 404 is the ordinary state of a Case Type that
  // has never been published.
  const missing = makeFetch(() => new Response('', { status: 404 }));
  const notPublished = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: missing.fetch,
  });
  assert.equal(await notPublished.getBankVersion('example-review'), null);
  assert.equal(
    await notPublished.getVersionedExport('example-review', 'abc123'),
    null
  );

  const garbled = makeFetch(() => ok('not json at all'));
  const broken = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: garbled.fetch,
  });
  assert.equal(await broken.getBankVersion('example-review'), null);
  assert.equal(
    await broken.getVersionedExport('example-review', 'abc123'),
    null
  );

  const notABank = makeFetch(() => ok(JSON.stringify({ slug: 'x' })));
  const shapeless = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: notABank.fetch,
  });
  assert.equal(await shapeless.getBankVersion('example-review'), null);
});
