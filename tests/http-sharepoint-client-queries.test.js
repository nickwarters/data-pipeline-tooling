// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import { WEB_URL, makeFetch } from './helpers/http-sharepoint-client.js';

// Capability: list queries, filters, paging, and counts.

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

  const cases = await client.listCases({}, { listName: 'Cases-ExampleReview' });

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

  await client.listCases(
    { status: 'In-progress', assignedReviewer: 'user-1' },
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(calls.length, 1);
  const url = decodeURIComponent(calls[0].url);
  assert.ok(url.includes("Status eq 'In-progress'"), 'should filter on Status');
  assert.ok(url.includes('user-1'), 'should filter on assigned reviewer id');
});

test('HttpSharePointClient: listCases targets the explicitly supplied listName (there is no default Case list)', async () => {
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

  await client.listCases({}, { listName: 'Cases-ExampleReview' });

  assert.ok(
    calls[0].url.includes("getbytitle('Cases-ExampleReview')"),
    'should use the supplied list name'
  );
});

test('HttpSharePointClient: listCases throws when called without a listName', async () => {
  const { fetch, calls } = makeFetch([]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await assert.rejects(() => client.listCases({}), /listName is required/);
  assert.equal(calls.length, 0, 'no fetch attempted');
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

  const cases = await client.listCases({}, { listName: 'Cases-ExampleReview' });
  assert.equal(cases.length, 1, 'should parse d.results format');
  assert.equal(cases[0].id, 'case-1');
});

// --- HTTP-date Retry-After ---

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

  await client.listCases(
    { overdue: true },
    { listName: 'Cases-ExampleReview' }
  );

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

  await client.listCases({}, { listName: 'Cases-ExampleReview' });

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

  await client.listCases(
    { effectiveOutcome: 'fail' },
    { listName: 'Cases-ExampleReview' }
  );

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

  await client.listCases(
    { outcomeOverridden: true },
    { listName: 'Cases-ExampleReview' }
  );

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

  await client.listCases(
    { responsibleParty: 'rp-user' },
    { listName: 'Cases-ExampleReview' }
  );

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

  await client.listCases(
    { assignedReviewerManager: 'mgr-user' },
    { listName: 'Cases-ExampleReview' }
  );

  const url = decodeURIComponent(calls[0].url);
  assert.ok(
    url.includes("AssignedReviewerManager eq 'mgr-user'"),
    'should filter on AssignedReviewerManager'
  );
});

// --- CompletedAt window filter (ADR-0031 §2) ---

test('HttpSharePointClient: listCases with a CompletedAt window leads with the indexed date column', async () => {
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

  await client.listCases(
    {
      status: 'Completed',
      completedAfter: '2026-07-02T00:00:00.000Z',
      completedBefore: '2026-07-03T00:00:00.000Z',
    },
    { listName: 'Cases-ExampleReview' }
  );

  const url = decodeURIComponent(calls[0].url);
  assert.ok(
    url.includes("CompletedAt ge '2026-07-02T00:00:00.000Z'"),
    'inclusive lower bound'
  );
  assert.ok(
    url.includes("CompletedAt lt '2026-07-03T00:00:00.000Z'"),
    'exclusive upper bound'
  );
  const filterExpr = url.slice(url.indexOf('$filter='));
  assert.ok(
    filterExpr.indexOf('CompletedAt') < filterExpr.indexOf('Status eq'),
    'the selective CompletedAt predicate leads Status (ADR-0031 §2)'
  );
});

test('HttpSharePointClient: countCases sums a bounded CompletedAt day-slice via $count', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => new Response('42', { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const n = await client.countCases(
    {
      caseType: 'example-review',
      status: 'Completed',
      completedAfter: '2026-07-02T00:00:00.000Z',
      completedBefore: '2026-07-03T00:00:00.000Z',
    },
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(n, 42);
  const url = decodeURIComponent(calls[0].url);
  assert.ok(url.includes('/items/$count'), 'a windowed count uses $count');
  assert.ok(url.includes("CompletedAt ge '2026-07-02T00:00:00.000Z'"));
  assert.ok(url.includes("CompletedAt lt '2026-07-03T00:00:00.000Z'"));
});

test('HttpSharePointClient: listCases without a CompletedAt window omits the CompletedAt condition', async () => {
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

  await client.listCases(
    { status: 'In-progress' },
    { listName: 'Cases-ExampleReview' }
  );

  const url = decodeURIComponent(calls[0].url);
  assert.ok(!url.includes('CompletedAt'), 'no CompletedAt when unbounded');
});

// --- Action Centre: countCases, paging, reason flags (issue #287) ---

test('HttpSharePointClient: countCases hits the $count endpoint and returns a bare integer', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => new Response('23', { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const n = await client.countCases(
    { overdue: true },
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(n, 23);
  const url = decodeURIComponent(calls[0].url);
  assert.ok(url.includes('/items/$count'), 'should use the $count endpoint');
  assert.ok(url.includes("Status eq 'In-progress'"), 'should carry the filter');
  assert.equal(
    calls.filter((c) => c.url.includes('$skip')).length,
    0,
    'a count never pages'
  );
});

test('HttpSharePointClient: countCases with no filter omits $filter and defaults non-numeric bodies to 0', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => new Response(JSON.stringify(null), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const n = await client.countCases({}, { listName: 'Cases-ExampleReview' });
  assert.equal(n, 0);
  assert.ok(!calls[0].url.includes('$filter'), 'no filter in the URL');
  assert.ok(calls[0].url.endsWith('/items/$count'));
});

test('HttpSharePointClient: countCases maps the reason flags to indexed boolean columns', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => new Response('4', { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.countCases(
    {
      awaitingResponsibleParty: true,
      reviewRequired: true,
      hasOpenAppeal: false,
      reopened: true,
    },
    { listName: 'Cases-ExampleReview' }
  );

  const url = decodeURIComponent(calls[0].url);
  assert.ok(url.includes('AwaitingResponsibleParty eq 1'));
  assert.ok(url.includes('ReviewRequired eq 1'));
  assert.ok(url.includes('HasOpenAppeal eq 0'));
  assert.ok(url.includes('Reopened eq 1'));
});

test('HttpSharePointClient: countCases with anyOf builds an OR of parenthesised sub-filters', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => new Response('7', { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.countCases(
    {
      anyOf: [
        { overdue: true },
        { awaitingResponsibleParty: true },
        {}, // empty sub-filter contributes nothing and is dropped
      ],
    },
    { listName: 'Cases-ExampleReview' }
  );

  const url = decodeURIComponent(calls[0].url);
  assert.ok(url.includes('(DueDate lt'), 'first sub-filter is parenthesised');
  assert.ok(url.includes(' or '), 'sub-filters are ORed');
  assert.ok(url.includes('AwaitingResponsibleParty eq 1'));
});

test('HttpSharePointClient: listCases with top/skip pages a single window without following nextLink', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            value: [{ Id: 'c1', Title: 'C1', Status: 'In-progress' }],
            'odata.nextLink': `${WEB_URL}/should-not-follow`,
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const rows = await client.listCases(
    { awaitingResponsibleParty: true },
    {
      listName: 'Cases-ExampleReview',
      top: 4,
      skip: 8,
      orderBy: 'awaitingSince',
      orderDir: 'asc',
    }
  );

  assert.equal(rows.length, 1);
  assert.equal(calls.length, 1, 'a paged read does not follow nextLink');
  const url = decodeURIComponent(calls[0].url);
  assert.ok(url.includes('$top=4'));
  assert.ok(url.includes('$skip=8'));
  assert.ok(url.includes('$orderby=awaitingSince'));
});

test('HttpSharePointClient: a paged read parses the legacy verbose { d: { results } } shape', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({ d: { results: [{ Id: 'c9', Title: 'C9' }] } }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const rows = await client.listCases(
    {},
    { listName: 'Cases-ExampleReview', top: 5 }
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'c9');
});

test('HttpSharePointClient: a paged read of an unrecognised body yields no rows', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(JSON.stringify({ nothing: true }), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  assert.deepEqual(
    await client.listCases({}, { listName: 'Cases-ExampleReview', top: 5 }),
    []
  );
});

test('HttpSharePointClient: listCases orderBy desc appends the desc direction', async () => {
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

  await client.listCases(
    {},
    {
      listName: 'Cases-ExampleReview',
      top: 1,
      orderBy: 'dueDate',
      orderDir: 'desc',
    }
  );

  const url = decodeURIComponent(calls[0].url);
  assert.ok(url.includes('$orderby=dueDate desc'));
});

test('HttpSharePointClient: listCases maps the reason columns from SP into the CaseRow', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            value: [
              {
                Id: 'c1',
                Title: 'C1',
                Status: 'In-progress',
                AwaitingResponsibleParty: true,
                AwaitingSince: '2026-06-01T00:00:00Z',
                ReviewRequired: true,
                HasOpenAppeal: false,
                AppealRaisedAt: '2026-06-02T00:00:00Z',
                Reopened: true,
                ReopenedAt: '2026-06-03T00:00:00Z',
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

  const [row] = await client.listCases(
    {},
    { listName: 'Cases-ExampleReview', top: 10 }
  );
  assert.equal(row.awaitingResponsibleParty, true);
  assert.equal(row.awaitingSince, '2026-06-01T00:00:00Z');
  assert.equal(row.reviewRequired, true);
  assert.equal(row.hasOpenAppeal, false);
  assert.equal(row.appealRaisedAt, '2026-06-02T00:00:00Z');
  assert.equal(row.reopened, true);
  assert.equal(row.reopenedAt, '2026-06-03T00:00:00Z');
});

test('HttpSharePointClient: listCases leaves reason columns undefined/null when SP omits them', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            value: [{ Id: 'c1', Title: 'C1', Status: 'In-progress' }],
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const [row] = await client.listCases(
    {},
    { listName: 'Cases-ExampleReview', top: 10 }
  );
  assert.equal(row.awaitingResponsibleParty, undefined);
  assert.equal(row.awaitingSince, null);
  assert.equal(row.reviewRequired, undefined);
  assert.equal(row.hasOpenAppeal, undefined);
  assert.equal(row.appealRaisedAt, null);
  assert.equal(row.reopened, undefined);
  assert.equal(row.reopenedAt, null);
});

test('HttpSharePointClient: countCases throws when called without a listName', async () => {
  const { fetch, calls } = makeFetch([]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await assert.rejects(() => client.countCases({}), /listName is required/);
  assert.equal(calls.length, 0, 'no fetch attempted');
});

// --- pre-existing branch-coverage gaps (unrelated to the strictness flip,
// closed here because this file is in scope for the migration ticket) -----

test('HttpSharePointClient: countCases defaults to 0 for a non-numeric (NaN) count body', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(JSON.stringify({ not: 'a number' }), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const n = await client.countCases({}, { listName: 'Cases-ExampleReview' });
  assert.equal(n, 0);
});

test('HttpSharePointClient: countCases returns n for a well-formed numeric count body', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => new Response('42', { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const n = await client.countCases({}, { listName: 'Cases-ExampleReview' });
  assert.equal(n, 42);
});

test('HttpSharePointClient: _getAllPages falls back to [] for an unrecognised page shape', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(JSON.stringify({ nothing: true }), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  // listCases with no top/skip drives the unpaged _getAllPages walk.
  const rows = await client.listCases({}, { listName: 'Cases-ExampleReview' });
  assert.deepEqual(rows, []);
});

test('HttpSharePointClient: countCases with every reason flag false renders every OData boolean as 0', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => new Response('0', { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.countCases(
    {
      awaitingResponsibleParty: false,
      reviewRequired: false,
      hasOpenAppeal: true,
      reopened: false,
      outcomeOverridden: false,
    },
    { listName: 'Cases-ExampleReview' }
  );

  const url = decodeURIComponent(calls[0].url);
  assert.ok(url.includes('AwaitingResponsibleParty eq 0'));
  assert.ok(url.includes('ReviewRequired eq 0'));
  assert.ok(url.includes('HasOpenAppeal eq 1'));
  assert.ok(url.includes('Reopened eq 0'));
  assert.ok(url.includes('OutcomeOverridden eq 0'));
});
