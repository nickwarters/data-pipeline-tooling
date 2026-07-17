// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import { WEB_URL, makeFetch } from './helpers/http-sharepoint-client.js';

// Capability: question definitions and versioned Question Bank exports.

test('HttpSharePointClient: getQuestionDefinitions with non-empty ids sends $filter and parses items', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            value: [
              {
                QuestionId: 'q-1',
                QuestionText: 'Was greeting professional?',
                ResponseType: 'yes-no-na',
                Deprecated: false,
              },
              {
                QuestionId: 'q-2',
                QuestionText: 'Were needs met?',
                ResponseType: 'yes-no-na',
                Deprecated: false,
              },
            ],
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const defs = await client.getQuestionDefinitions(['q-1', 'q-2']);
  assert.equal(defs.length, 2);
  assert.ok(defs.some((d) => d.id === 'q-1'));
  assert.ok(defs.some((d) => d.id === 'q-2'));
  const url = decodeURIComponent(calls[0].url);
  assert.ok(
    url.includes("QuestionId eq 'q-1'"),
    'URL should have filter for q-1'
  );
});

test('HttpSharePointClient: getQuestionDefinitions with single-choice and multi-choice response types', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            value: [
              {
                QuestionId: 'q-sc',
                QuestionText: 'Choose one',
                ResponseType: 'single-choice',
                Options: '["A","B"]',
                Deprecated: false,
              },
              {
                QuestionId: 'q-mc',
                QuestionText: 'Choose many',
                ResponseType: 'multi-choice',
                Options: '["X","Y"]',
                Deprecated: false,
              },
            ],
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const defs = await client.getQuestionDefinitions(['q-sc', 'q-mc']);
  const sc = defs.find((d) => d.id === 'q-sc');
  const mc = defs.find((d) => d.id === 'q-mc');
  assert.equal(sc?.responseType, 'single-choice');
  assert.deepEqual(sc?.options, ['A', 'B']);
  assert.equal(mc?.responseType, 'multi-choice');
  assert.deepEqual(mc?.options, ['X', 'Y']);
});

test('HttpSharePointClient: getQuestionDefinitions parses a non-empty RemediationActions array', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            value: [
              {
                QuestionId: 'q-rem',
                QuestionText: 'Needs remediation?',
                ResponseType: 'yes-no-na',
                RemediationActions: JSON.stringify([
                  { id: 'ra-1', text: 'Contact customer' },
                ]),
                Deprecated: false,
              },
            ],
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const [def] = await client.getQuestionDefinitions(['q-rem']);
  assert.deepEqual(def.remediationActions, [
    { id: 'ra-1', text: 'Contact customer' },
  ]);
});

// --- legacy OData verbose format ---

test('HttpSharePointClient: getExportHash fetches {slug}.json and returns the hash field', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET' && c.url.includes('example-review.json'),
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
    calls[0].url.includes('example-review.json'),
    'fetches the {slug}.json file from the Style Library'
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

// --- getVersionedExport (ADR-0021 Step 4) ---

test('HttpSharePointClient: getVersionedExport fetches {slug}.{hash}.json and returns parsed body', async () => {
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
    calls[0].url.includes(encodeURIComponent(hash)),
    'URL contains the URL-encoded hash'
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

test('HttpSharePointClient: getQuestionDefinitions with an empty ids array returns [] without calling fetch', async () => {
  const { fetch, calls } = makeFetch([]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  assert.deepEqual(await client.getQuestionDefinitions([]), []);
  assert.equal(calls.length, 0);
});

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

test('HttpSharePointClient: getQuestionDefinitions falls back from QuestionId to Id and from QuestionText to Title', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            value: [
              { Id: 'fallback-id', Title: 'Fallback Title' }, // no QuestionId/QuestionText/Deprecated
            ],
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const [def] = await client.getQuestionDefinitions(['fallback-id']);
  assert.equal(def.id, 'fallback-id');
  assert.equal(def.text, 'Fallback Title');
  assert.equal(
    def.deprecated,
    false,
    '?? false fallback when Deprecated is absent'
  );
});

test('HttpSharePointClient: getQuestionDefinitions falls all the way to empty strings when QuestionId/Id and QuestionText/Title are all absent', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(JSON.stringify({ value: [{}] }), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const [def] = await client.getQuestionDefinitions(['whatever']);
  assert.equal(def.id, '');
  assert.equal(def.text, '');
});

test('HttpSharePointClient: getQuestionDefinitions parses OptionOutcomes and ShowWhen, ignoring FailureCriteria', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            value: [
              {
                QuestionId: 'q-full',
                QuestionText: 'Full question',
                ResponseType: 'outcome',
                OptionOutcomes: JSON.stringify({ Yes: 'pass', No: 'fail' }),
                ShowWhen: JSON.stringify({ questionId: 'q-x', equals: 'Yes' }),
                FailureCriteria: 'No',
                Deprecated: true,
              },
            ],
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const [def] = await client.getQuestionDefinitions(['q-full']);
  assert.deepEqual(def.optionOutcomes, { Yes: 'pass', No: 'fail' });
  assert.deepEqual(def.showWhen, { questionId: 'q-x', equals: 'Yes' });
  // FailureCriteria list columns are ignored: failure derives from the
  // outcome mapping at load, never from stored criteria.
  assert.equal('failureCriteria' in def, false);
  assert.equal(def.deprecated, true);
});
