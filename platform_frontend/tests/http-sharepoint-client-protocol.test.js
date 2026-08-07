// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import {
  WEB_URL,
  digestResponse,
  makeFetch,
  makeSleep,
} from './helpers/http-sharepoint-client.js';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';

isolateBrowserGlobals();

// Capability: authentication, retries, throttling, and HTTP adapters.

test('HttpSharePointClient: form digest is fetched lazily and reused across writes', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('digest-1'),
    },
    {
      when: (c) => c.method === 'PATCH',
      respond: () =>
        new Response(null, { status: 204, headers: { ETag: '"new-etag"' } }),
    },
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-1',
            Title: 'X',
            Status: 'In-progress',
            AssignedReviewerId: 'u1',
            ResponsiblePartyId: 'u2',
            Answers: '{}',
            Conversation: '[]',
            Notes: '',
            CompletedAt: null,
            CaseType: 'example-review',
          }),
          { status: 200, headers: { ETag: '"new-etag"' } }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.patchCase('case-1', { notes: 'first' }, '"old-etag"', {
    listName: 'Cases-ExampleReview',
  });
  await client.patchCase('case-1', { notes: 'second' }, '"new-etag"', {
    listName: 'Cases-ExampleReview',
  });

  const digestCalls = calls.filter((c) => c.url.endsWith('/_api/contextinfo'));
  assert.equal(digestCalls.length, 1, 'digest should be fetched only once');
  const patchCalls = calls.filter((c) => c.method === 'PATCH');
  assert.equal(patchCalls.length, 2);
  assert.equal(patchCalls[0].headers['x-requestdigest'], 'digest-1');
  assert.equal(patchCalls[1].headers['x-requestdigest'], 'digest-1');
});

test('HttpSharePointClient: 403 on write triggers digest refresh and one retry', async () => {
  let digestCount = 0;
  let patchCount = 0;
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => {
        digestCount++;
        return digestResponse(digestCount === 1 ? 'digest-A' : 'digest-B');
      },
    },
    {
      when: (c) => c.method === 'PATCH',
      respond: () => {
        patchCount++;
        if (patchCount === 1) return new Response('forbidden', { status: 403 });
        return new Response(null, {
          status: 204,
          headers: { ETag: '"after-refresh"' },
        });
      },
    },
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-1',
            Title: 'X',
            Status: 'In-progress',
            AssignedReviewerId: 'u1',
            ResponsiblePartyId: 'u2',
            Answers: '{}',
            Conversation: '[]',
            Notes: 'done',
            CompletedAt: null,
            CaseType: 'example-review',
          }),
          { status: 200, headers: { ETag: '"after-refresh"' } }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await client.patchCase('case-1', { notes: 'done' }, '"e1"', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(result.ok, true);
  assert.equal(digestCount, 2, 'digest fetched twice (initial + refresh)');
  const patches = calls.filter((c) => c.method === 'PATCH');
  assert.equal(patches.length, 2);
  assert.equal(patches[0].headers['x-requestdigest'], 'digest-A');
  assert.equal(
    patches[1].headers['x-requestdigest'],
    'digest-B',
    'retry uses refreshed digest'
  );
});

test('HttpSharePointClient: 403 retry that also fails is surfaced (no infinite loop)', async () => {
  let digestCount = 0;
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => {
        digestCount++;
        return digestResponse('d-' + digestCount);
      },
    },
    {
      when: (c) => c.method === 'PATCH',
      respond: () => new Response('forbidden', { status: 403 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await client.patchCase('case-1', { notes: 'x' }, '"e1"', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(digestCount, 2, 'refresh attempted exactly once');
});

// --- ETag / If-Match ---

test('HttpSharePointClient: 412 on PATCH returns {ok:false, status:412} without refreshing the digest', async () => {
  let digestCount = 0;
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => {
        digestCount++;
        return digestResponse('d');
      },
    },
    {
      when: (c) => c.method === 'PATCH',
      respond: () => new Response('precondition failed', { status: 412 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await client.patchCase('case-1', { notes: 'n' }, '"stale"', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 412);
  assert.equal(digestCount, 1, '412 must not trigger digest refresh');
});

// --- 429 throttling ---

test('HttpSharePointClient: 429 with Retry-After waits the indicated seconds before retrying', async () => {
  let getCount = 0;
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => {
        getCount++;
        if (getCount === 1) {
          return new Response('throttled', {
            status: 429,
            headers: { 'Retry-After': '3' },
          });
        }
        return new Response(
          JSON.stringify({
            Id: 'case-1',
            Title: 'OK',
            Status: 'In-progress',
            AssignedReviewerId: 'u1',
            ResponsiblePartyId: 'u2',
            Answers: '{}',
            Conversation: '[]',
            Notes: '',
            CompletedAt: null,
            CaseType: 'example-review',
          }),
          { status: 200, headers: { ETag: '"ok"' } }
        );
      },
    },
  ]);
  const { sleep, delays } = makeSleep();
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
    sleep,
  });

  const row = await client.getCase('case-1', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(row?.id, 'case-1');
  assert.equal(calls.filter((c) => c.method === 'GET').length, 2);
  assert.deepEqual(delays, [3000]);
});

test('HttpSharePointClient: 429 without Retry-After falls back to a default delay', async () => {
  let getCount = 0;
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => {
        getCount++;
        if (getCount === 1) return new Response('throttled', { status: 429 });
        return new Response(
          JSON.stringify({
            Id: 'case-1',
            Title: 'OK',
            Status: 'In-progress',
            AssignedReviewerId: 'u1',
            ResponsiblePartyId: 'u2',
            Answers: '{}',
            Conversation: '[]',
            Notes: '',
            CompletedAt: null,
            CaseType: 'example-review',
          }),
          { status: 200, headers: { ETag: '"ok"' } }
        );
      },
    },
  ]);
  const { sleep, delays } = makeSleep();
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
    sleep,
  });

  await client.getCase('case-1', { listName: 'Cases-ExampleReview' });

  assert.equal(delays.length, 1);
  assert.ok(delays[0] >= 1000, 'fallback delay should be at least 1s');
});

test('HttpSharePointClient: 429 with garbage Retry-After string falls back to default delay', async () => {
  let getCount = 0;
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => {
        getCount++;
        if (getCount === 1) {
          // Non-numeric, non-date Retry-After → parseRetryAfter returns DEFAULT_THROTTLE_MS (line 286)
          return new Response('throttled', {
            status: 429,
            headers: { 'Retry-After': 'not-a-number-or-date' },
          });
        }
        return new Response(
          JSON.stringify({
            Id: 'case-1',
            Title: 'OK',
            Status: 'In-progress',
            AssignedReviewerId: 'u1',
            ResponsiblePartyId: 'u2',
            Answers: '{}',
            Conversation: '[]',
            Notes: '',
            CompletedAt: null,
            CaseType: 'example-review',
          }),
          { status: 200, headers: { ETag: '"ok"' } }
        );
      },
    },
  ]);
  const { sleep, delays } = makeSleep();
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
    sleep,
  });

  await client.getCase('case-1', { listName: 'Cases-ExampleReview' });

  assert.equal(delays.length, 1);
  assert.ok(
    delays[0] >= 1000,
    'garbage Retry-After should fall back to default delay (≥ 1s)'
  );
});

test('HttpSharePointClient: 429 with HTTP-date Retry-After waits until that time', async () => {
  // Use a date 2 seconds in the future
  const futureMs = Date.now() + 2000;
  const httpDate = new Date(futureMs).toUTCString();

  let getCount = 0;
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => {
        getCount++;
        if (getCount === 1) {
          return new Response('throttled', {
            status: 429,
            headers: { 'Retry-After': httpDate },
          });
        }
        return new Response(
          JSON.stringify({
            Id: 'case-1',
            Title: 'OK',
            Status: 'In-progress',
            AssignedReviewerId: 'u1',
            ResponsiblePartyId: 'u2',
            Answers: '{}',
            Conversation: '[]',
            Notes: '',
            CompletedAt: null,
            CaseType: 'example-review',
          }),
          { status: 200, headers: { ETag: '"ok"' } }
        );
      },
    },
  ]);
  const { sleep, delays } = makeSleep();
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
    sleep,
  });

  await client.getCase('case-1', { listName: 'Cases-ExampleReview' });

  assert.equal(delays.length, 1, 'should have slept once');
  // The delay should be roughly 2 seconds (± some tolerance for test run time)
  assert.ok(delays[0] >= 0, 'delay should be non-negative');
  assert.ok(delays[0] <= 3000, 'delay should not be wildly large');
});

test('HttpSharePointClient: defaults to globalThis.fetch when fetchImpl is not supplied', async () => {
  const originalFetch = globalThis.fetch;
  /** @type {any[]} */
  const calls = [];
  globalThis.fetch = async (
    /** @type {any} */ input,
    /** @type {any} */ init
  ) => {
    calls.push({ input, init });
    return new Response(
      JSON.stringify({ Id: 'case-1', Title: 'T', Status: 'In-progress' }),
      { status: 200 }
    );
  };
  try {
    const client = new HttpSharePointClient({ webUrl: WEB_URL });
    const row = await client.getCase('case-1', {
      listName: 'Cases-ExampleReview',
    });
    assert.equal(row?.id, 'case-1');
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HttpSharePointClient: defaults to a real setTimeout-backed sleep when sleep is not supplied', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  // Fire immediately so the default sleep implementation runs without
  // actually waiting out the 429 retry delay in this test.
  // @ts-ignore
  globalThis.setTimeout = (/** @type {any} */ cb) => {
    cb();
    return /** @type {any} */ (0);
  };
  let getCount = 0;
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => {
        getCount++;
        if (getCount === 1) {
          return new Response('throttled', {
            status: 429,
            headers: { 'Retry-After': '0' },
          });
        }
        return new Response(
          JSON.stringify({ Id: 'case-1', Title: 'T', Status: 'In-progress' }),
          { status: 200 }
        );
      },
    },
  ]);
  try {
    const client = new HttpSharePointClient({
      webUrl: WEB_URL,
      fetchImpl: fetch,
    });
    const row = await client.getCase('case-1', {
      listName: 'Cases-ExampleReview',
    });
    assert.equal(row?.id, 'case-1');
    assert.equal(getCount, 2, 'retried once after the default sleep resolved');
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

// --- type-shape compile-time check ---

test('HttpSharePointClient: assignable to SharePointClient interface', () => {
  /** @type {import('../src/sharepoint-client.js').SharePointClient} */
  const c = new HttpSharePointClient({ webUrl: WEB_URL });
  assert.equal(typeof c.getCase, 'function');
  assert.equal(typeof c.patchCase, 'function');
  assert.equal(typeof c.listCases, 'function');
  assert.equal(typeof c.getCurrentUserGroups, 'function');
  assert.equal(typeof c.getCurrentUser, 'function');
  assert.equal(typeof c.searchPeople, 'function');
});

// --- listCases overdue OData filter ---

test('HttpSharePointClient: _request defaults to an empty init object when none is supplied', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(JSON.stringify({ value: [] }), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const body = await client._request(WEB_URL + '/_api/web/lists');
  assert.deepEqual(body, { value: [] });
  assert.equal(calls.length, 1);
});

test('HttpSharePointClient: _refreshDigest reads the verbose d.GetContextWebInformation.FormDigestValue envelope', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () =>
        new Response(
          JSON.stringify({
            d: {
              GetContextWebInformation: { FormDigestValue: 'verbose-digest' },
            },
          }),
          { status: 200 }
        ),
    },
    {
      when: (c) => c.method === 'PATCH',
      respond: () =>
        new Response(null, { status: 204, headers: { ETag: '"v2"' } }),
    },
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-1',
            Title: 'T',
            Status: 'In-progress',
            Answers: '{}',
            Conversation: '[]',
            Notes: 'n',
            CompletedAt: null,
            CaseType: 'example-review',
          }),
          { status: 200, headers: { ETag: '"v2"' } }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.patchCase('case-1', { notes: 'n' }, '"v1"', {
    listName: 'Cases-ExampleReview',
  });

  const patch = calls.find((c) => c.method === 'PATCH');
  assert.equal(patch?.headers['x-requestdigest'], 'verbose-digest');
});

test('HttpSharePointClient: _refreshDigest throws when the contextinfo response carries no FormDigestValue', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => new Response(JSON.stringify({}), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  // patchCase's own try/catch would swallow the throw into {ok:false}, so
  // exercise the digest refresh directly to assert the throw itself.
  await assert.rejects(
    () => client._refreshDigest(),
    /FormDigestValue missing/
  );
});

test('HttpSharePointClient: _absolute prefixes a relative path that does not start with a slash', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: () => true,
      respond: () =>
        new Response(JSON.stringify({ hash: 'h' }), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
    exportBasePath: 'Style%20Library/case-review/case-types', // no leading slash
  });

  await client.getExportHash('example-review');

  assert.equal(
    calls[0].url,
    `${WEB_URL}/Style%20Library/case-review/case-types/example-review.json`
  );
});
