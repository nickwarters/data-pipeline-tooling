// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';

/** @typedef {{ method: string, url: string, headers: Record<string, string>, body: string|null }} CapturedCall */

/**
 * Build a fake fetch that returns successive Responses from `responses`,
 * matching by predicate. If no predicate matches, throws.
 * Records every call into `calls`.
 *
 * @param {Array<{ when: (call: CapturedCall) => boolean, respond: () => Response }>} responses
 * @returns {{ fetch: (input: RequestInfo|URL, init?: RequestInit) => Promise<Response>, calls: CapturedCall[] }}
 */
function makeFetch(responses) {
  /** @type {CapturedCall[]} */
  const calls = [];
  const idxByRule = responses.map(() => 0);
  return {
    calls,
    async fetch(input, init = {}) {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init.method ?? 'GET').toUpperCase();
      /** @type {Record<string, string>} */
      const headers = {};
      const h = init.headers;
      if (h) {
        if (h instanceof Headers) {
          h.forEach((v, k) => {
            headers[k.toLowerCase()] = v;
          });
        } else if (Array.isArray(h)) {
          for (const [k, v] of h) headers[k.toLowerCase()] = String(v);
        } else {
          for (const k of Object.keys(h))
            headers[k.toLowerCase()] = String(/** @type {any} */ (h)[k]);
        }
      }
      const body = init.body == null ? null : String(init.body);
      /** @type {CapturedCall} */
      const call = { method, url, headers, body };
      calls.push(call);
      for (let i = 0; i < responses.length; i++) {
        if (responses[i].when(call)) {
          idxByRule[i]++;
          return responses[i].respond();
        }
      }
      throw new Error(`No fake fetch rule matched: ${method} ${url}`);
    },
  };
}

/**
 * Build a fake sleep that records every delay it was asked to wait.
 * @returns {{ sleep: (ms: number) => Promise<void>, delays: number[] }}
 */
function makeSleep() {
  /** @type {number[] } */
  const delays = [];
  return {
    delays,
    async sleep(ms) {
      delays.push(ms);
    },
  };
}

/**
 * Convenience: build a digest contextinfo response.
 * @param {string} digest
 */
function digestResponse(digest) {
  return new Response(JSON.stringify({ FormDigestValue: digest }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const WEB_URL = 'https://sp.example.com/sites/casereview';

// --- Case Details round-trip (issue #213) ---

test('HttpSharePointClient: getCase parses the Details JSON blob into CaseRow.details', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-1',
            Title: 'T',
            Status: 'In-progress',
            AssignedReviewerId: 'u1',
            ResponsiblePartyId: 'u2',
            Answers: '{}',
            Conversation: '[]',
            Details: JSON.stringify({
              customerName: 'Jordan Lee',
              accountNumber: 'ACC-4471',
            }),
            Notes: '',
            CompletedAt: null,
            CaseType: 'example-review',
          }),
          { status: 200, headers: { ETag: '"v1"' } }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const row = await client.getCase('case-1');

  assert.deepEqual(row?.details, {
    customerName: 'Jordan Lee',
    accountNumber: 'ACC-4471',
  });
});

test('HttpSharePointClient: patchCase serialises CaseRow.details to the Details column', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d'),
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
            AssignedReviewerId: 'u1',
            ResponsiblePartyId: 'u2',
            Answers: '{}',
            Conversation: '[]',
            Notes: '',
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

  const details = { customerName: 'Jordan Lee', accountNumber: 'ACC-4471' };
  await client.patchCase('case-1', { details }, '"v1"');

  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch, 'PATCH was issued');
  const body = JSON.parse(String(patch.body));
  assert.equal(body.Details, JSON.stringify(details));
});

// --- form digest ---

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

  await client.patchCase('case-1', { notes: 'first' }, '"old-etag"');
  await client.patchCase('case-1', { notes: 'second' }, '"new-etag"');

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

  const result = await client.patchCase('case-1', { notes: 'done' }, '"e1"');

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

  const result = await client.patchCase('case-1', { notes: 'x' }, '"e1"');

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(digestCount, 2, 'refresh attempted exactly once');
});

// --- ETag / If-Match ---

test('HttpSharePointClient: PATCH sends If-Match header with the supplied ETag', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d'),
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
            AssignedReviewerId: 'u1',
            ResponsiblePartyId: 'u2',
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

  await client.patchCase('case-1', { notes: 'n' }, '"v1"');

  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch, 'PATCH was issued');
  assert.equal(patch.headers['if-match'], '"v1"');
});

test('HttpSharePointClient: patchCase writes mutable CaseRow fields to SharePoint columns', async () => {
  const appeal = {
    id: 'appeal-1',
    appellant: 'rp-1',
    at: '2026-06-02T10:00:00.000Z',
    rationale: 'Dispute outcome',
    state: /** @type {'resolved'} */ ('resolved'),
    resolution: {
      verdict: /** @type {'agreed'} */ ('agreed'),
      rationale: 'Accepted',
      resolver: 'qa-reviewer',
      at: '2026-06-03T10:00:00.000Z',
    },
  };
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d'),
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
            Status: 'Completed',
            AssignedReviewerId: 'u1',
            ResponsiblePartyId: 'u2',
            Answers: '{}',
            Conversation: '[]',
            Notes: 'n',
            CompletedAt: '2026-06-01T10:00:00.000Z',
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

  await client.patchCase(
    'case-1',
    {
      caseJustification: 'documented rationale',
      reportableAt: '2026-05-30T10:00:00.000Z',
      remediationDueDate: '2026-06-15',
      completedAt: '2026-06-01T10:00:00.000Z',
      outcome: 'fail',
      outcomeAtCompletion: 'fail',
      questionBankVersion: 'hash-123',
      hadRemediation: true,
      effectiveOutcome: 'pass',
      effectiveHadRemediation: false,
      outcomeOverridden: true,
      amendedOutcome: {
        outcome: 'pass',
        justification: 'Corrected after appeal',
        amendedBy: 'controls-1',
        amendedAt: '2026-06-12T10:00:00.000Z',
      },
      appeals: [appeal],
      dueDate: '2026-06-10T10:00:00.000Z',
      relatedDate: null,
      assignedReviewerManager: null,
      responsiblePartyManager: 'rp-manager',
    },
    '"v1"'
  );

  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch, 'PATCH was issued');
  const body = JSON.parse(String(patch.body));
  assert.deepEqual(body, {
    CaseJustification: 'documented rationale',
    ReportableAt: '2026-05-30T10:00:00.000Z',
    RemediationDueDate: '2026-06-15',
    CompletedAt: '2026-06-01T10:00:00.000Z',
    Outcome: 'fail',
    OutcomeAtCompletion: 'fail',
    QuestionBankVersion: 'hash-123',
    HadRemediation: true,
    EffectiveOutcome: 'pass',
    EffectiveHadRemediation: false,
    OutcomeOverridden: true,
    AmendedOutcome: JSON.stringify({
      outcome: 'pass',
      justification: 'Corrected after appeal',
      amendedBy: 'controls-1',
      amendedAt: '2026-06-12T10:00:00.000Z',
    }),
    Appeals: JSON.stringify([appeal]),
    DueDate: '2026-06-10T10:00:00.000Z',
    RelatedDate: null,
    AssignedReviewerManager: null,
    ResponsiblePartyManager: 'rp-manager',
  });
});

test('HttpSharePointClient: patchCase result.data.etag reflects the new ETag from the response', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d'),
    },
    {
      when: (c) => c.method === 'PATCH',
      respond: () =>
        new Response(null, { status: 204, headers: { ETag: '"server-new"' } }),
    },
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-1',
            Title: 'T',
            Status: 'In-progress',
            AssignedReviewerId: 'u1',
            ResponsiblePartyId: 'u2',
            Answers: '{}',
            Conversation: '[]',
            Notes: 'n',
            CompletedAt: null,
            CaseType: 'example-review',
          }),
          { status: 200, headers: { ETag: '"server-new"' } }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await client.patchCase('case-1', { notes: 'n' }, '"v1"');

  assert.equal(result.ok, true);
  assert.equal(result.data?.etag, '"server-new"');
});

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

  const result = await client.patchCase('case-1', { notes: 'n' }, '"stale"');

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

  const row = await client.getCase('case-1');

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

  await client.getCase('case-1');

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

  await client.getCase('case-1');

  assert.equal(delays.length, 1);
  assert.ok(
    delays[0] >= 1000,
    'garbage Retry-After should fall back to default delay (≥ 1s)'
  );
});

test('HttpSharePointClient: getCase returns fallback empty objects when Answers/Conversation are invalid JSON', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-bad',
            Title: 'Bad JSON',
            Status: 'In-progress',
            CaseType: 'example-review',
            AssignedReviewerId: 'u1',
            ResponsiblePartyId: 'u2',
            Answers: 'not valid json {{{',
            Conversation: 'also invalid',
            Notes: '',
            CompletedAt: null,
          }),
          { status: 200, headers: { ETag: '"v1"' } }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const row = await client.getCase('case-bad');

  // parseJsonField catch block returns fallback for invalid JSON (lines 349-350)
  assert.deepEqual(row?.answers, {}, 'invalid Answers JSON falls back to {}');
  assert.deepEqual(
    row?.conversation,
    [],
    'invalid Conversation JSON falls back to []'
  );
});

// --- pagination ---

test('HttpSharePointClient: listCases follows odata.nextLink across pages and concatenates results', async () => {
  const page2Url = `${WEB_URL}/_api/web/lists/getbytitle('Cases-ExampleReview')/items?$skiptoken=PAGE2`;
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET' && c.url.includes('$skiptoken=PAGE2'),
      respond: () =>
        new Response(
          JSON.stringify({
            value: [
              {
                Id: 'case-3',
                Title: 'Three',
                Status: 'In-progress',
                AssignedReviewerId: 'u1',
                ResponsiblePartyId: 'u2',
                Answers: '{}',
                Conversation: '[]',
                Notes: '',
                CompletedAt: null,
                CaseType: 'example-review',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ),
    },
    {
      when: (c) =>
        c.method === 'GET' &&
        c.url.includes("getbytitle('Cases-ExampleReview')"),
      respond: () =>
        new Response(
          JSON.stringify({
            value: [
              {
                Id: 'case-1',
                Title: 'One',
                Status: 'In-progress',
                AssignedReviewerId: 'u1',
                ResponsiblePartyId: 'u2',
                Answers: '{}',
                Conversation: '[]',
                Notes: '',
                CompletedAt: null,
                CaseType: 'example-review',
              },
              {
                Id: 'case-2',
                Title: 'Two',
                Status: 'In-progress',
                AssignedReviewerId: 'u1',
                ResponsiblePartyId: 'u2',
                Answers: '{}',
                Conversation: '[]',
                Notes: '',
                CompletedAt: null,
                CaseType: 'example-review',
              },
            ],
            'odata.nextLink': page2Url,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const cases = await client.listCases({});

  assert.equal(cases.length, 3);
  assert.deepEqual(
    cases.map((c) => c.id),
    ['case-1', 'case-2', 'case-3']
  );
  assert.equal(calls.filter((c) => c.method === 'GET').length, 2);
});

test('HttpSharePointClient: listCases applies status and assignedReviewer filters via $filter', async () => {
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

  await client.listCases({ status: 'In-progress', assignedReviewer: 'user-1' });

  assert.equal(calls.length, 1);
  const url = decodeURIComponent(calls[0].url);
  assert.ok(url.includes("Status eq 'In-progress'"), 'should filter on Status');
  assert.ok(url.includes('user-1'), 'should filter on assigned reviewer id');
});

test('HttpSharePointClient: listCases uses default case list when no list override is supplied', async () => {
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

  await client.listCases({});

  assert.ok(
    calls[0].url.includes("getbytitle('Cases-ExampleReview')"),
    'should use the default case list'
  );
});

test('HttpSharePointClient: listCases can target a supplied SharePoint list', async () => {
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

  await client.listCases({ status: 'In-progress' }, { listName: 'complaints' });

  const url = decodeURIComponent(calls[0].url);
  assert.ok(
    url.includes("getbytitle('complaints')"),
    'should use the supplied list override'
  );
  assert.ok(url.includes("Status eq 'In-progress'"), 'should keep filters');
});

// --- getCase / getCurrentUser ---

test('HttpSharePointClient: getCase returns null on 404', async () => {
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

  const row = await client.getCase('case-missing');
  assert.equal(row, null);
});

test('HttpSharePointClient: getCase parses Answers/Conversation JSON blobs and captures ETag', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-1',
            Title: 'Hello',
            Status: 'In-progress',
            CaseType: 'example-review',
            AssignedReviewerId: 'user-1',
            ResponsiblePartyId: 'user-2',
            Answers: JSON.stringify({ 'q-welcome': { value: 'Yes' } }),
            Conversation: JSON.stringify([
              { author: 'user-1', timestamp: 't', body: 'hi' },
            ]),
            Notes: 'note',
            CompletedAt: null,
          }),
          { status: 200, headers: { ETag: '"v7"' } }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const row = await client.getCase('case-1');

  assert.equal(row?.id, 'case-1');
  assert.equal(row?.etag, '"v7"');
  assert.equal(row?.answers['q-welcome']?.value, 'Yes');
  assert.equal(row?.conversation.length, 1);
  assert.equal(row?.assignedReviewer, 'user-1');
});

test('HttpSharePointClient: getCase can target a supplied SharePoint list', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-1',
            Title: 'Complaint Case',
            Status: 'In-progress',
            AssignedReviewerId: 'u1',
            ResponsiblePartyId: 'u2',
            Answers: '{}',
            Conversation: '[]',
            Notes: '',
            CompletedAt: null,
            CaseType: 'product-sale-review',
          }),
          { status: 200, headers: { ETag: '"v1"' } }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const row = await client.getCase('case-1', { listName: 'complaints' });

  assert.equal(row?.title, 'Complaint Case');
  assert.ok(
    calls[0].url.includes("getbytitle('complaints')"),
    'GET should target the supplied list name'
  );
});

test('HttpSharePointClient: getCase hydrates the full CaseRow contract', async () => {
  const appeals = [
    {
      id: 'appeal-1',
      appellant: 'rp-1',
      at: '2026-06-02T10:00:00.000Z',
      rationale: 'Dispute outcome',
      state: 'raised',
    },
  ];
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-1',
            Title: 'Full row',
            Status: 'Completed',
            CaseType: 'example-review',
            AssignedReviewerId: 'reviewer-1',
            AssignedReviewerManager: 'reviewer-manager',
            ResponsiblePartyId: 'rp-1',
            ResponsiblePartyManager: 'rp-manager',
            Answers: '{}',
            Conversation: '[]',
            Notes: 'note',
            CaseJustification: 'documented rationale',
            ReportableAt: '2026-06-02T10:00:00.000Z',
            RemediationDueDate: '2026-06-16',
            CompletedAt: '2026-06-03T10:00:00.000Z',
            Outcome: 'fail',
            OutcomeAtCompletion: 'refer',
            QuestionBankVersion: 'hash-123',
            HadRemediation: true,
            EffectiveOutcome: 'pass',
            EffectiveHadRemediation: false,
            OutcomeOverridden: true,
            AmendedOutcome: JSON.stringify({
              outcome: 'pass',
              justification: 'Corrected after appeal',
              amendedBy: 'controls-1',
              amendedAt: '2026-06-12T10:00:00.000Z',
            }),
            Appeals: JSON.stringify(appeals),
            DueDate: '2026-06-10T10:00:00.000Z',
            RelatedDate: '2026-06-04T10:00:00.000Z',
            Created: '2026-06-01T09:00:00.000Z',
            Overdue: false,
          }),
          { status: 200, headers: { ETag: '"v7"' } }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const row = await client.getCase('case-1');

  assert.equal(row?.caseJustification, 'documented rationale');
  assert.equal(row?.reportableAt, '2026-06-02T10:00:00.000Z');
  assert.equal(row?.remediationDueDate, '2026-06-16');
  assert.equal(row?.outcome, 'fail');
  assert.equal(row?.outcomeAtCompletion, 'refer');
  assert.equal(row?.questionBankVersion, 'hash-123');
  assert.equal(row?.hadRemediation, true);
  assert.equal(row?.effectiveOutcome, 'pass');
  assert.equal(row?.effectiveHadRemediation, false);
  assert.equal(row?.outcomeOverridden, true);
  assert.deepEqual(row?.amendedOutcome, {
    outcome: 'pass',
    justification: 'Corrected after appeal',
    amendedBy: 'controls-1',
    amendedAt: '2026-06-12T10:00:00.000Z',
  });
  assert.deepEqual(row?.appeals, appeals);
  assert.equal(row?.dueDate, '2026-06-10T10:00:00.000Z');
  assert.equal(row?.relatedDate, '2026-06-04T10:00:00.000Z');
  assert.equal(row?.created, '2026-06-01T09:00:00.000Z');
  assert.equal(row?.overdue, false);
});

test('HttpSharePointClient: getCurrentUser returns id and displayName', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 42,
            Title: 'Alice Reviewer',
            LoginName: 'i:0#.w|domain\\alice',
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const u = await client.getCurrentUser();
  assert.equal(u.id, 'alice');
  assert.equal(u.displayName, 'Alice Reviewer');
});

test('HttpSharePointClient: getCurrentUserGroups returns group titles', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            value: [
              { Id: 1, Title: 'Reviewers' },
              { Id: 2, Title: 'CaseTypeOwners' },
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

  const groups = await client.getCurrentUserGroups();
  assert.deepEqual(groups, ['Reviewers', 'CaseTypeOwners']);
});

// --- patchCase 200 with JSON body ---

test('HttpSharePointClient: patchCase handles 200 response with JSON body (no separate getCase)', async () => {
  const patchBody = {
    Id: 'case-1',
    Title: 'Updated',
    Status: 'In-progress',
    AssignedReviewerId: 'u1',
    ResponsiblePartyId: 'u2',
    Answers: '{}',
    Conversation: '[]',
    Notes: 'n',
    CompletedAt: null,
    CaseType: 'example-review',
  };
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('digest-x'),
    },
    {
      when: (c) => c.method === 'PATCH',
      respond: () =>
        new Response(JSON.stringify(patchBody), {
          status: 200,
          headers: { ETag: '"v2"', 'Content-Type': 'application/json' },
        }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await client.patchCase('case-1', { notes: 'n' }, '"v1"');
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.data?.title, 'Updated');
});

test('HttpSharePointClient: patchCase can target a supplied SharePoint list', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'POST' && c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('digest-1'),
    },
    {
      when: (c) => c.method === 'PATCH',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-1',
            Title: 'Complaint Case',
            Status: 'In-progress',
            AssignedReviewerId: 'u1',
            ResponsiblePartyId: 'u2',
            Answers: '{}',
            Conversation: '[]',
            Notes: 'done',
            CompletedAt: null,
            CaseType: 'product-sale-review',
          }),
          { status: 200, headers: { ETag: '"v2"' } }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await client.patchCase('case-1', { notes: 'done' }, '"v1"', {
    listName: 'complaints',
  });

  assert.equal(result.ok, true);
  const patchCall = calls.find((c) => c.method === 'PATCH');
  assert.ok(
    patchCall?.url.includes("getbytitle('complaints')"),
    'PATCH should target the supplied list name'
  );
});

// --- getQuestionDefinitions with non-empty ids ---

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

// --- legacy OData verbose format ---

test('HttpSharePointClient: _getAllPages handles legacy d.results OData format', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            d: {
              results: [
                {
                  Id: 'case-1',
                  Title: 'One',
                  Status: 'In-progress',
                  AssignedReviewerId: 'u1',
                  ResponsiblePartyId: 'u2',
                  Answers: '{}',
                  Conversation: '[]',
                  Notes: '',
                  CompletedAt: null,
                  CaseType: 'example-review',
                },
              ],
            },
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const cases = await client.listCases({});
  assert.equal(cases.length, 1, 'should parse d.results format');
  assert.equal(cases[0].id, 'case-1');
});

// --- HTTP-date Retry-After ---

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

  await client.getCase('case-1');

  assert.equal(delays.length, 1, 'should have slept once');
  // The delay should be roughly 2 seconds (± some tolerance for test run time)
  assert.ok(delays[0] >= 0, 'delay should be non-negative');
  assert.ok(delays[0] <= 3000, 'delay should not be wildly large');
});

// --- type-shape compile-time check ---

test('HttpSharePointClient: assignable to SharePointClient interface', () => {
  /** @type {import('../src/sharepoint-client.js').SharePointClient} */
  const c = new HttpSharePointClient({ webUrl: WEB_URL });
  assert.equal(typeof c.getCase, 'function');
  assert.equal(typeof c.patchCase, 'function');
  assert.equal(typeof c.listCases, 'function');
  assert.equal(typeof c.getQuestionDefinitions, 'function');
  assert.equal(typeof c.getCurrentUserGroups, 'function');
  assert.equal(typeof c.getCurrentUser, 'function');
  assert.equal(typeof c.searchPeople, 'function');
});

// --- listCases overdue OData filter ---

test('HttpSharePointClient: listCases with overdue:true adds DueDate lt and Status eq In-progress OData conditions', async () => {
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

  await client.listCases({ overdue: true });

  assert.equal(calls.length, 1);
  const url = decodeURIComponent(calls[0].url);
  assert.ok(url.includes('DueDate lt '), 'should include DueDate lt condition');
  assert.ok(
    url.includes("Status eq 'In-progress'"),
    'should restrict to In-progress cases'
  );
});

test('HttpSharePointClient: listCases without overdue filter omits DueDate condition', async () => {
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

  await client.listCases({});

  const url = decodeURIComponent(calls[0].url);
  assert.ok(
    !url.includes('DueDate'),
    'should not include DueDate when overdue filter not set'
  );
});

test('HttpSharePointClient: listCases with effectiveOutcome filters server-side on EffectiveOutcome (ADR-0019)', async () => {
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

  await client.listCases({ effectiveOutcome: 'fail' });

  const url = decodeURIComponent(calls[0].url);
  assert.ok(
    url.includes("EffectiveOutcome eq 'fail'"),
    'bounded server-side filter on the corrected result'
  );
});

test('HttpSharePointClient: listCases with outcomeOverridden filters on the OutcomeOverridden flag (ADR-0019)', async () => {
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

  await client.listCases({ outcomeOverridden: true });

  const url = decodeURIComponent(calls[0].url);
  assert.ok(
    url.includes('OutcomeOverridden eq 1'),
    'corrected-Case segment uses the indexed boolean column'
  );
});

test('HttpSharePointClient: listCases with responsibleParty filters server-side on ResponsiblePartyId', async () => {
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

  await client.listCases({ responsibleParty: 'rp-user' });

  const url = decodeURIComponent(calls[0].url);
  assert.ok(
    url.includes("ResponsiblePartyId eq 'rp-user'"),
    'should filter on ResponsiblePartyId'
  );
});

test('HttpSharePointClient: listCases with assignedReviewerManager filters server-side on AssignedReviewerManager', async () => {
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

  await client.listCases({ assignedReviewerManager: 'mgr-user' });

  const url = decodeURIComponent(calls[0].url);
  assert.ok(
    url.includes("AssignedReviewerManager eq 'mgr-user'"),
    'should filter on AssignedReviewerManager'
  );
});

test('HttpSharePointClient: getCase maps AssignedReviewerManager and ResponsiblePartyManager from SP columns', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-x',
            Title: 'X',
            Status: 'In-progress',
            CaseType: 'example-review',
            AssignedReviewerId: 'user-r',
            ResponsiblePartyId: 'user-rp',
            AssignedReviewerManager: 'mgr-r',
            ResponsiblePartyManager: 'mgr-rp',
            Answers: '{}',
            Conversation: '[]',
            Notes: '',
            CompletedAt: null,
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });
  const row = await client.getCase('case-x');
  assert.equal(row?.assignedReviewerManager, 'mgr-r');
  assert.equal(row?.responsiblePartyManager, 'mgr-rp');
});

test('HttpSharePointClient: patchCase writes assignedReviewerManager and responsiblePartyManager to SP columns', async () => {
  const existingItem = {
    Id: 'case-x',
    Title: 'X',
    Status: 'In-progress',
    CaseType: 'example-review',
    AssignedReviewerId: 'user-r',
    ResponsiblePartyId: 'user-rp',
    Answers: '{}',
    Conversation: '[]',
    Notes: '',
    CompletedAt: null,
    'odata.etag': '"etag-1"',
  };
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d1'),
    },
    {
      when: (c) => c.method === 'PATCH',
      respond: () =>
        new Response(JSON.stringify({ ...existingItem }), {
          status: 200,
          headers: { ETag: '"etag-2"' },
        }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });
  await client.patchCase(
    'case-x',
    { assignedReviewerManager: 'mgr-r', responsiblePartyManager: 'mgr-rp' },
    '"etag-1"'
  );
  const patchCall = calls.find((c) => c.method === 'PATCH');
  const body = JSON.parse(patchCall?.body ?? '{}');
  assert.equal(body.AssignedReviewerManager, 'mgr-r');
  assert.equal(body.ResponsiblePartyManager, 'mgr-rp');
});

// --- searchPeople ---

test('HttpSharePointClient: searchPeople POSTs to the people-picker endpoint, queries the directory, and returns bare accounts', async () => {
  const entities = [
    {
      Key: 'i:0#.w|CONTOSO\\jsmith',
      DisplayText: 'John Smith',
      EntityData: { Email: 'jsmith@contoso.com' },
    },
    { Key: 'i:0#.w|CONTOSO\\bjones', DisplayText: 'Bola Jones' },
    { Key: 'i:0#.w|CONTOSO\\noname' },
  ];
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d1'),
    },
    {
      when: (c) => c.method === 'POST',
      respond: () =>
        new Response(JSON.stringify({ value: JSON.stringify(entities) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const results = await client.searchPeople('smith');

  assert.deepEqual(results, [
    {
      loginName: 'jsmith',
      displayName: 'John Smith',
      email: 'jsmith@contoso.com',
    },
    { loginName: 'bjones', displayName: 'Bola Jones' },
    { loginName: 'noname', displayName: 'noname' },
  ]);
  const post = calls.find(
    (c) => c.method === 'POST' && c.url.includes('clientPeoplePickerSearchUser')
  );
  assert.ok(post, 'POSTs to clientPeoplePickerSearchUser');
  const sent = JSON.parse(/** @type {string} */ (post?.body));
  assert.equal(sent.queryParams.QueryString, 'smith');
  assert.equal(
    sent.queryParams.PrincipalSource,
    15,
    'queries all sources incl. the directory'
  );
  assert.equal(sent.queryParams.PrincipalType, 1, 'users only');
});

test('HttpSharePointClient: searchPeople reads the verbose d.ClientPeoplePickerSearchUser envelope', async () => {
  const entities = [{ Key: 'CONTOSO\\asmith', DisplayText: 'Anna Smith' }];
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d1'),
    },
    {
      when: (c) => c.method === 'POST',
      respond: () =>
        new Response(
          JSON.stringify({
            d: { ClientPeoplePickerSearchUser: JSON.stringify(entities) },
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const results = await client.searchPeople('anna');
  assert.deepEqual(results, [
    { loginName: 'asmith', displayName: 'Anna Smith' },
  ]);
});

test('HttpSharePointClient: searchPeople returns [] when the response carries no recognised payload', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d1'),
    },
    {
      when: (c) => c.method === 'POST',
      respond: () => new Response(JSON.stringify({}), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  assert.deepEqual(await client.searchPeople('x'), []);
});

test('HttpSharePointClient: searchPeople short-circuits a blank query without calling fetch', async () => {
  const { fetch, calls } = makeFetch([]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  assert.deepEqual(await client.searchPeople('   '), []);
  assert.equal(calls.length, 0);
});

test('HttpSharePointClient: searchPeople throws on a non-ok response', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d1'),
    },
    {
      when: (c) => c.method === 'POST',
      respond: () => new Response('err', { status: 500 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await assert.rejects(() => client.searchPeople('x'), /HTTP Error: 500/);
});

// --- resolveUsers ---

/** @param {string} displayName */
function profileResponse(displayName) {
  return new Response(JSON.stringify({ DisplayName: displayName }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('HttpSharePointClient: resolveUsers resolves display names via GetPropertiesFor, reattaching the claims prefix and domain', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) =>
        c.url.includes('GetPropertiesFor') && c.url.includes('jsmith'),
      respond: () => profileResponse('John Smith'),
    },
    {
      when: (c) =>
        c.url.includes('GetPropertiesFor') && c.url.includes('bjones'),
      respond: () => profileResponse('Bola Jones'),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const resolved = await client.resolveUsers(['jsmith', 'bjones']);
  assert.deepEqual(resolved, { jsmith: 'John Smith', bjones: 'Bola Jones' });

  // The stored bare account is expanded to a full claims login at the boundary.
  const jcall = calls.find((c) => c.url.includes('jsmith'));
  assert.ok(jcall, 'a profile read was made for jsmith');
  assert.equal(jcall?.method, 'GET');
  assert.ok(jcall?.url.includes('CONTOSO'), 'reattaches the AD domain');
});

test('HttpSharePointClient: resolveUsers dedupes repeated accounts into a single read', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.includes('GetPropertiesFor'),
      respond: () => profileResponse('John Smith'),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const resolved = await client.resolveUsers(['jsmith', 'jsmith', 'jsmith']);
  assert.deepEqual(resolved, { jsmith: 'John Smith' });
  assert.equal(
    calls.filter((c) => c.url.includes('GetPropertiesFor')).length,
    1,
    'one read per unique account'
  );
});

test('HttpSharePointClient: resolveUsers maps to null when the profile has no DisplayName', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.includes('GetPropertiesFor'),
      respond: () => profileResponse(''),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  assert.deepEqual(await client.resolveUsers(['ghost']), { ghost: null });
});

test('HttpSharePointClient: resolveUsers maps to null when the profile read fails', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.includes('GetPropertiesFor'),
      respond: () => new Response('nope', { status: 500 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  assert.deepEqual(await client.resolveUsers(['ghost']), { ghost: null });
});

test('HttpSharePointClient: resolveUsers returns an empty map without any read for an empty list', async () => {
  const { fetch, calls } = makeFetch([]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  assert.deepEqual(await client.resolveUsers([]), {});
  assert.equal(calls.length, 0);
});

// --- getExportHash (ADR-0021 Step 3) ---

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
        failureCriteria: null,
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
