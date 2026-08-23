// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import { WEB_URL, makeFetch } from './helpers/http-sharepoint-client.js';

// Capability: versioned Question Bank exports (getBankVersion / getVersionedExport).

// --- legacy OData verbose format ---

test('HttpSharePointClient: getBankVersion reads the version the bank artifact declares', async () => {
  /** @type {import('../src/pages/question-bank/question-bank-source.js').QuestionBank} */
  const bank = {
    slug: 'example-review',
    label: 'Example Review',
    version: 'hand-entered-v7',
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

  const version = await client.getBankVersion('example-review');

  // Read, never computed: the bank declares its version and the Case is
  // stamped with the declaration verbatim. A hand-entered identifier is as
  // good as a minted one — recomputing anything here would stamp a value no
  // published file answers to.
  assert.equal(version, 'hand-entered-v7');
  assert.ok(
    calls[0].url.endsWith('/case-types/banks/example-review.txt'),
    'reads the bank artifact from the deployed banks folder'
  );
});

test('HttpSharePointClient: getBankVersion is unmoved by key order and formatting on the wire', async () => {
  /** @type {import('../src/pages/question-bank/question-bank-source.js').QuestionBank} */
  const bank = {
    slug: 'example-review',
    label: 'Example Review',
    version: 'v3',
    questions: [
      { id: 'q1', text: 'T', responseType: 'yes-no-na', deprecated: false },
    ],
  };
  // Same declaration, different key order and formatting on the wire: the
  // version is a field read out of the parsed artifact, so neither can move it.
  const reordered = {
    questions: bank.questions,
    version: bank.version,
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
    }).getBankVersion('example-review'),
    await new HttpSharePointClient({
      webUrl: WEB_URL,
      fetchImpl: second.fetch,
    }).getBankVersion('example-review')
  );
});

test('HttpSharePointClient: getBankVersion returns null when the file is not found (404)', async () => {
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

  const hash = await client.getBankVersion('example-review');
  assert.equal(hash, null);
});

test('HttpSharePointClient: getBankVersion returns null when the bank declares no version', async () => {
  // A bank without a `version` is a bank that has never been published as one.
  // It stamps nothing rather than blocking completion — the Case simply is not
  // frozen, the documented pre-versioning state.
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

  const version = await client.getBankVersion('example-review');
  assert.equal(version, null);
});

// --- getVersionedExport ---

test('HttpSharePointClient: getVersionedExport reads the version-named artifact and returns its parsed body', async () => {
  const hash = 'a'.repeat(64);
  const versionedPayload = {
    slug: 'example-review',
    version: hash,
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
    // The stamped identifier reaches the filename unchanged.
    calls[0].url.endsWith(`example-review.${'a'.repeat(64)}.txt`),
    `expected the version-named artifact, got ${calls[0].url}`
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
