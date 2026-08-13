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
    ok(JSON.stringify({ hash: 'sha256:abc' }))
  );
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  assert.equal(await client.getExportHash('example-review'), 'sha256:abc');
  await client.getVersionedExport('example-review', 'sha256:abc');

  assert.ok(
    calls[0].url.endsWith('/case-types/banks/example-review.export.txt'),
    `expected the current export artifact, got ${calls[0].url}`
  );
  assert.ok(
    calls[1].url.endsWith('/case-types/banks/example-review.sha256-abc.txt'),
    `expected the versioned artifact, got ${calls[1].url}`
  );
  // The web URL is not involved: these are not list reads.
  assert.equal(calls[0].url.startsWith(WEB_URL), false);
});

test('a version hash reaches the filename with its colon replaced', async () => {
  // `sha256:<hex>` cannot be a filename — `:` is illegal in a Windows path and
  // rejected by SharePoint — so the name carries a hyphen while the identity
  // stamped on the Case row keeps its colon.
  const { fetch, calls } = makeFetch(() => ok('{}'));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.getVersionedExport('example-review', `sha256:${'a'.repeat(64)}`);

  assert.ok(calls[0].url.endsWith(`.sha256-${'a'.repeat(64)}.txt`));
  assert.equal(calls[0].url.includes(':'), true, 'the https: scheme survives');
  assert.equal(
    calls[0].url.includes('sha256:'),
    false,
    'the hash colon must not reach the filename'
  );
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
  assert.equal(await notPublished.getExportHash('example-review'), null);
  assert.equal(
    await notPublished.getVersionedExport('example-review', 'sha256:abc'),
    null
  );

  const garbled = makeFetch(() => ok('not json at all'));
  const broken = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: garbled.fetch,
  });
  assert.equal(await broken.getExportHash('example-review'), null);
  assert.equal(
    await broken.getVersionedExport('example-review', 'sha256:abc'),
    null
  );

  const empty = makeFetch(() => ok(JSON.stringify({ hash: '' })));
  const unpublished = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: empty.fetch,
  });
  assert.equal(await unpublished.getExportHash('example-review'), null);
});
