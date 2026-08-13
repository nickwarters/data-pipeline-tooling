// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import { WEB_URL, makeFetch } from './helpers/http-sharepoint-client.js';
import { bankVersionHash } from '../src/lib/bank-version.js';

// Capability: versioned Question Bank exports (getExportHash / getVersionedExport).

// --- legacy OData verbose format ---

test('HttpSharePointClient: getExportHash derives the current version from the bank artifact', async () => {
  /** @type {import('../src/pages/question-bank/question-bank-source.js').QuestionBank} */
  const bank = {
    slug: 'example-review',
    label: 'Example Review',
    questions: [
      { id: 'q1', text: 'T', responseType: 'yes-no-na', deprecated: false },
    ],
  };
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET' && c.url.includes('example-review.txt'),
      respond: () => new Response(JSON.stringify(bank), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const hash = await client.getExportHash('example-review');

  // The identity is a fact about the bank's content, so the client and the
  // publish step reach it through the same function rather than agreeing on a
  // value written into a file.
  assert.equal(hash, await bankVersionHash(bank));
  assert.match(/** @type {string} */ (hash), /^[0-9a-f]{64}$/);
  assert.ok(
    calls[0].url.endsWith('/case-types/banks/example-review.txt'),
    'reads the bank artifact from the deployed banks folder'
  );
});

test('HttpSharePointClient: getExportHash is stable across calls for unchanged content', async () => {
  /** @type {import('../src/pages/question-bank/question-bank-source.js').QuestionBank} */
  const bank = {
    slug: 'example-review',
    label: 'Example Review',
    questions: [
      { id: 'q1', text: 'T', responseType: 'yes-no-na', deprecated: false },
    ],
  };
  // Same content, different key order and formatting on the wire: the digest is
  // over a canonical form, so neither can move a version's identity.
  const reordered = {
    questions: bank.questions,
    label: bank.label,
    slug: bank.slug,
  };
  const first = makeFetch([
    { when: () => true, respond: () => new Response(JSON.stringify(bank)) },
  ]);
  const second = makeFetch([
    {
      when: () => true,
      respond: () => new Response(JSON.stringify(reordered, null, 4)),
    },
  ]);

  assert.equal(
    await new HttpSharePointClient({
      webUrl: WEB_URL,
      fetchImpl: first.fetch,
    }).getExportHash('example-review'),
    await new HttpSharePointClient({
      webUrl: WEB_URL,
      fetchImpl: second.fetch,
    }).getExportHash('example-review')
  );
});

test('HttpSharePointClient: getExportHash returns null when the file is not found (404)', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => new Response('not found', { status: 404 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const hash = await client.getExportHash('example-review');
  assert.equal(hash, null);
});

test('HttpSharePointClient: getExportHash returns null when the artifact is not a bank', async () => {
  // A version identity is only meaningful over bank content. Anything else —
  // a stray file, an error page served with a 200 — stamps nothing rather than
  // stamping a hash of whatever arrived.
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(JSON.stringify({ slug: 'example-review' }), {
          status: 200,
        }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const hash = await client.getExportHash('example-review');
  assert.equal(hash, null);
});

test('HttpSharePointClient: assignable to SharePointClient interface (includes getExportHash)', () => {
  /** @type {import('../src/sharepoint-client.js').SharePointClient} */
  const c = new HttpSharePointClient({ webUrl: WEB_URL });
  assert.equal(typeof c.getExportHash, 'function');
});

// --- getVersionedExport ---

test('HttpSharePointClient: getVersionedExport reads the hash-named artifact and returns its parsed body', async () => {
  const hash = 'a'.repeat(64);
  const versionedPayload = {
    slug: 'example-review',
    hash,
    generatedAt: '2026-01-10T09:00:00.000Z',
    questions: [
      {
        id: 'q1',
        text: 'T',
        category: null,
        responseType: 'yes-no-na',
        options: null,
        showWhen: null,
        deprecated: false,
      },
    ],
  };
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET' && c.url.includes('example-review'),
      respond: () =>
        new Response(JSON.stringify(versionedPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    },
  ]);

  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });
  const result = await client.getVersionedExport('example-review', hash);

  assert.deepEqual(result, versionedPayload);
  assert.ok(calls[0].url.includes('example-review'), 'URL contains the slug');
  assert.ok(
    // The identity is the digest, so it reaches the filename unchanged.
    calls[0].url.endsWith(`example-review.${'a'.repeat(64)}.txt`),
    `expected the hash-named artifact, got ${calls[0].url}`
  );
});

test('HttpSharePointClient: getVersionedExport returns null on 404', async () => {
  const { fetch } = makeFetch([
    {
      when: () => true,
      respond: () => new Response('not found', { status: 404 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });
  const result = await client.getVersionedExport('example-review', 'abc');
  assert.equal(result, null);
});

test('HttpSharePointClient: getVersionedExport returns null on network error', async () => {
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async () => {
      throw new Error('Network error');
    },
  });
  const result = await client.getVersionedExport('example-review', 'abc');
  assert.equal(result, null);
});

test('HttpSharePointClient: assignable to SharePointClient interface (includes getVersionedExport)', () => {
  /** @type {import('../src/sharepoint-client.js').SharePointClient} */
  const c = new HttpSharePointClient({ webUrl: WEB_URL });
  assert.equal(typeof c.getVersionedExport, 'function');
});

// --- strictness: listName is mandatory (no default Case list) ---

test('HttpSharePointClient: getVersionedExport returns null when the parsed body is not an object', async () => {
  const { fetch } = makeFetch([
    {
      when: () => true,
      respond: () =>
        new Response(JSON.stringify('just a string'), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await client.getVersionedExport('example-review', 'abc');
  assert.equal(result, null);
});
