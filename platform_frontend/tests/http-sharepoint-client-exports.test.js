// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import { WEB_URL, makeFetch } from './helpers/http-sharepoint-client.js';

// Capability: versioned Question Bank exports (getExportHash / getVersionedExport).

// --- legacy OData verbose format ---

test('HttpSharePointClient: getExportHash reads the current export artifact and returns its hash', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) =>
        c.method === 'GET' && c.url.includes('example-review.export.txt'),
      respond: () =>
        new Response(
          JSON.stringify({
            slug: 'example-review',
            hash: 'sha256:aabbccdd',
            generatedAt: '2026-06-01T00:00:00Z',
            questions: [],
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const hash = await client.getExportHash('example-review');

  assert.equal(hash, 'sha256:aabbccdd');
  assert.ok(
    calls[0].url.endsWith('/case-types/banks/example-review.export.txt'),
    'reads the current export artifact from the deployed banks folder'
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

test('HttpSharePointClient: getExportHash returns null when the response carries no hash field', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({ slug: 'example-review', questions: [] }),
          {
            status: 200,
          }
        ),
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
  const hash = 'sha256:' + 'a'.repeat(64);
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
    // Filename-safe form: the identity keeps its `sha256:` prefix, the file is
    // named by the digest alone.
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
  const result = await client.getVersionedExport(
    'example-review',
    'sha256:abc'
  );
  assert.equal(result, null);
});

test('HttpSharePointClient: getVersionedExport returns null on network error', async () => {
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async () => {
      throw new Error('Network error');
    },
  });
  const result = await client.getVersionedExport(
    'example-review',
    'sha256:abc'
  );
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

  const result = await client.getVersionedExport(
    'example-review',
    'sha256:abc'
  );
  assert.equal(result, null);
});
