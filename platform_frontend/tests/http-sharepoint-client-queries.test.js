// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import {
  WEB_URL,
  emptyPageClient,
  makeFetch,
  peopleFilterFetch,
} from './helpers/http-sharepoint-client.js';

// Capability: list queries, filters, paging, and counts.

const INDEXED_FILTER_COLUMNS = new Set([
  'CompletedAt',
  'VoidedAt',
  'ReportableAt',
  'Modified',
]);

/**
 * SharePoint uses the first predicate to decide whether a large list can be
 * served from an index.
 *
 * @param {string} url
 */
function assertLeadsWithIndexedPredicate(url) {
  const filter = new URL(url).searchParams.get('$filter') ?? '';
  const leadingColumn = filter.match(/^\(*\s*([A-Za-z]+)/)?.[1] ?? null;
  assert.ok(
    leadingColumn && INDEXED_FILTER_COLUMNS.has(leadingColumn),
    `the read must lead with an indexed column, got ${leadingColumn}`
  );
}

/**
 * A `countCases` response page: the `$select=Id` projection SharePoint returns,
 * optionally carrying an `odata.nextLink` to a further page.
 *
 * @param {number} n
 * @param {string} [nextLink]
 */
function idPage(n, nextLink) {
  /** @type {Record<string, unknown>} */
  const body = { value: Array.from({ length: n }, (_, i) => ({ Id: i + 1 })) };
  if (nextLink) body['odata.nextLink'] = nextLink;
  return new Response(JSON.stringify(body), { status: 200 });
}

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
  const { fetch, calls } = peopleFilterFetch({ 'user-1': 5 });
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.listCases(
    { status: 'In-progress', assignedReviewer: 'user-1' },
    { listName: 'Cases-ExampleReview' }
  );

  const url = decodeURIComponent(
    String(calls.find((c) => c.url.includes('/items?'))?.url)
  );
  assert.ok(url.includes("Status eq 'In-progress'"), 'should filter on Status');
  assert.ok(
    url.includes('AssignedReviewerId eq 5'),
    'should filter on the reviewer person id'
  );
});

test('HttpSharePointClient: listCases targets the explicitly supplied listName (there is no default Case list)', async () => {
  const { client, calls } = emptyPageClient();

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
  const { client, calls } = emptyPageClient();

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
  const { client, calls } = emptyPageClient();

  await client.listCases(
    { overdue: true },
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(calls.length, 1);
  const url = decodeURIComponent(calls[0].url);
  assert.ok(url.includes('DueDate lt '), 'should include DueDate lt condition');
  assert.ok(
    url.includes("(Status eq 'In-progress')"),
    'should restrict to the statuses the review clock still runs in'
  );
});

test('HttpSharePointClient: listCases with overdue:false adds the negated, null-safe DueDate condition', async () => {
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
    { onHold: true, overdue: false },
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(calls.length, 1);
  const url = decodeURIComponent(calls[0].url);
  assert.ok(url.includes('OnHold eq 1'), 'should keep the onHold condition');
  assert.match(
    url,
    /\(Status ne 'In-progress' or DueDate eq null or DueDate ge '[^']+'\)/,
    'should negate the overdue rule from the same status list, null DueDate included'
  );
});

test('HttpSharePointClient: listCases without overdue filter omits DueDate condition', async () => {
  const { client, calls } = emptyPageClient();

  await client.listCases({}, { listName: 'Cases-ExampleReview' });

  const url = decodeURIComponent(calls[0].url);
  assert.ok(
    !url.includes('DueDate'),
    'should not include DueDate when overdue filter not set'
  );
});

test('HttpSharePointClient: listCases with effectiveOutcome filters server-side on EffectiveOutcome', async () => {
  const { client, calls } = emptyPageClient();

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

test('HttpSharePointClient: listCases with outcomeOverridden filters on the OutcomeOverridden flag', async () => {
  const { client, calls } = emptyPageClient();

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
  const { fetch, calls } = peopleFilterFetch({ 'rp-user': 31 });
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.listCases(
    { responsibleParty: 'rp-user' },
    { listName: 'Cases-ExampleReview' }
  );

  const url = decodeURIComponent(
    String(calls.find((c) => c.url.includes('/items?'))?.url)
  );
  assert.ok(
    url.includes('ResponsiblePartyId eq 31'),
    'should filter on ResponsiblePartyId'
  );
});

test('HttpSharePointClient: an assignedReviewerManager filter compares against the numeric person id', async () => {
  // The manager column is a Person column like the other two, and this filter
  // leads every Team Cases read — a quoted account against the lookup returns
  // an empty team, which reads as "you manage nobody" rather than an error.
  const { fetch, calls } = peopleFilterFetch({ 'mgr-user': 41 });
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.listCases(
    { assignedReviewerManager: 'mgr-user' },
    { listName: 'Cases-ExampleReview' }
  );

  const url = decodeURIComponent(
    String(calls.find((c) => c.url.includes('/items?'))?.url)
  );
  assert.ok(
    url.includes('AssignedReviewerManagerId eq 41'),
    'the filter names the id column and compares unquoted'
  );
  assert.ok(!url.includes("eq '41'"), 'a quoted number is not a person id');
  assert.ok(
    !url.includes('mgr-user'),
    'the account name never reaches the query'
  );
});

// --- CompletedAt window filter ---

test('HttpSharePointClient: listCases filters by a CompletedAt window and status', async () => {
  const { client, calls } = emptyPageClient();

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
  assert.ok(
    url.includes("Status eq 'Completed'"),
    'should filter on completed status'
  );
  assertLeadsWithIndexedPredicate(calls[0].url);
});

// --- The void report window ---

test('HttpSharePointClient: a void report filters by the VoidedAt window and status', async () => {
  const { client, calls } = emptyPageClient();

  await client.listCases(
    {
      status: 'Void',
      voidedAfter: '2026-07-02T00:00:00.000Z',
      voidedBefore: '2026-08-02T00:00:00.000Z',
    },
    { listName: 'Cases-ExampleReview' }
  );

  const url = decodeURIComponent(calls[0].url);
  assert.ok(
    url.includes("VoidedAt ge '2026-07-02T00:00:00.000Z'"),
    'inclusive lower bound'
  );
  assert.ok(
    url.includes("VoidedAt lt '2026-08-02T00:00:00.000Z'"),
    'exclusive upper bound'
  );
  assert.ok(url.includes("Status eq 'Void'"), 'should filter on void status');
  assertLeadsWithIndexedPredicate(calls[0].url);

  await client.listCases(
    { status: 'Void' },
    { listName: 'Cases-ExampleReview' }
  );
  assert.ok(
    !decodeURIComponent(calls[1].url).includes('VoidedAt'),
    'no window, no condition'
  );
});

// --- Case search: the ReportableAt window and the Title prefix ---

test('HttpSharePointClient: a Case search filters by ReportableAt, Title prefix, and status', async () => {
  const { client, calls } = emptyPageClient();

  await client.listCases(
    {
      titlePrefix: "O'Brien",
      reportableAfter: '2026-07-02T00:00:00.000Z',
      reportableBefore: '2026-07-03T00:00:00.000Z',
      status: 'In-progress',
    },
    { listName: 'Cases-ExampleReview' }
  );

  const url = decodeURIComponent(calls[0].url);
  assert.ok(
    url.includes("ReportableAt ge '2026-07-02T00:00:00.000Z'"),
    'inclusive lower bound'
  );
  assert.ok(
    url.includes("ReportableAt lt '2026-07-03T00:00:00.000Z'"),
    'exclusive upper bound'
  );
  // An apostrophe in a Case Reference is doubled, as it is in every other
  // string literal the client emits — an unescaped one would end the literal
  // early and make the rest of the reference a syntax error.
  assert.ok(
    url.includes("startswith(Title,'O''Brien')"),
    'the prefix is an anchored startswith with a doubled apostrophe'
  );
  assert.ok(
    !url.includes('substringof'),
    'an unanchored contains cannot be served from an index'
  );
  assert.ok(
    url.includes("Status eq 'In-progress'"),
    'should filter on in-progress status'
  );
  assertLeadsWithIndexedPredicate(calls[0].url);
});

test('HttpSharePointClient: countCases sums a bounded CompletedAt day-slice', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => idPage(42),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const n = await client.countCases(
    {
      status: 'Completed',
      completedAfter: '2026-07-02T00:00:00.000Z',
      completedBefore: '2026-07-03T00:00:00.000Z',
    },
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(n, 42);
  const url = decodeURIComponent(calls[0].url);
  assert.ok(!url.includes('$count'), 'SharePoint SE has no $count segment');
  assert.ok(url.includes('$select=Id'), 'a count reads the Id column only');
  assert.ok(url.includes("CompletedAt ge '2026-07-02T00:00:00.000Z'"));
  assert.ok(url.includes("CompletedAt lt '2026-07-03T00:00:00.000Z'"));
});

test('HttpSharePointClient: listCases without a CompletedAt window omits the CompletedAt condition', async () => {
  const { client, calls } = emptyPageClient();

  await client.listCases(
    { status: 'In-progress' },
    { listName: 'Cases-ExampleReview' }
  );

  const url = decodeURIComponent(calls[0].url);
  assert.ok(!url.includes('CompletedAt'), 'no CompletedAt when unbounded');
});

// --- Action Centre: countCases, paging, reason flags ---

test('HttpSharePointClient: countCases counts an Id-only read, never the unroutable $count segment', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => idPage(23),
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
  assert.ok(
    !url.includes('$count'),
    'SharePoint SE answers /items/$count with "Cannot find a resource"'
  );
  assert.ok(url.includes('$select=Id'), 'only the Id column crosses the wire');
  assert.ok(url.includes('$top=5000'), 'pages at the List View Threshold');
  assert.ok(url.includes("Status eq 'In-progress'"), 'should carry the filter');
  assert.equal(calls.length, 1, 'one page, one request');
});

test('HttpSharePointClient: countCases follows odata.nextLink and sums every page', async () => {
  const page2 = `${WEB_URL}/_api/web/lists/getbytitle('Cases-ExampleReview')/items?$skiptoken=PAGE2`;
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET' && c.url.includes('$skiptoken=PAGE2'),
      respond: () => idPage(7),
    },
    {
      when: (c) => c.method === 'GET',
      respond: () => idPage(5000, page2),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const n = await client.countCases(
    { hasOpenAppeal: true },
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(n, 5007, 'a matched set past the page size counts every page');
  assert.equal(calls.length, 2);
});

test('HttpSharePointClient: countCases with no filter omits $filter and counts an empty page as 0', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => idPage(0),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const n = await client.countCases({}, { listName: 'Cases-ExampleReview' });
  assert.equal(n, 0);
  assert.ok(!calls[0].url.includes('$filter'), 'no filter in the URL');
});

test('HttpSharePointClient: countCases maps the reason flags to indexed boolean columns', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => idPage(4),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.countCases(
    {
      awaitingResponsibleParty: true,
      hasOpenAppeal: false,
    },
    { listName: 'Cases-ExampleReview' }
  );

  const url = decodeURIComponent(calls[0].url);
  assert.ok(url.includes('AwaitingResponsibleParty eq 1'));
  assert.ok(url.includes('HasOpenAppeal eq 0'));
});

test('HttpSharePointClient: countCases maps non-held capacity to the indexed OnHold column', async () => {
  const { fetch, calls } = peopleFilterFetch({ 'reviewer-1': 9 }, () =>
    idPage(2)
  );
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.countCases(
    {
      status: 'In-progress',
      assignedReviewer: 'reviewer-1',
      onHold: false,
    },
    { listName: 'Cases-Complaints' }
  );

  const url = decodeURIComponent(
    String(calls.find((c) => c.url.includes('/items?'))?.url)
  );
  assert.ok(url.includes("Status eq 'In-progress'"));
  assert.ok(url.includes('AssignedReviewerId eq 9'));
  assert.ok(url.includes('OnHold eq 0'));
});

test('HttpSharePointClient: countCases with anyOf builds an OR of parenthesised sub-filters', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => idPage(7),
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
  assert.ok(url.includes('$orderby=AwaitingSince'));
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
  const { client, calls } = emptyPageClient();

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
  assert.ok(url.includes('$orderby=DueDate desc'));
});

test('HttpSharePointClient: listCases maps every CaseRow sort key to its internal column name', async () => {
  const { client, calls } = emptyPageClient();

  /** @type {[string, string][]} */
  const pairs = [
    ['appealRaisedAt', 'AppealRaisedAt'],
    ['awaitingSince', 'AwaitingSince'],
    ['placedOnHoldAt', 'PlacedOnHoldAt'],
    ['dueDate', 'DueDate'],
    ['created', 'Created'],
    ['completedAt', 'CompletedAt'],
    ['reportableAt', 'ReportableAt'],
    ['remediationDueDate', 'RemediationDueDate'],
    ['relatedDate', 'RelatedDate'],
    ['title', 'Title'],
    ['status', 'Status'],
    ['id', 'Id'],
  ];

  for (const [key] of pairs) {
    await client.listCases(
      {},
      { listName: 'Cases-ExampleReview', top: 1, orderBy: key }
    );
  }

  const urls = calls.map((c) => decodeURIComponent(c.url));
  pairs.forEach(([, column], i) => {
    assert.ok(
      urls[i].includes(`$orderby=${column}`),
      `expected $orderby=${column} for ${pairs[i][0]}, got ${urls[i]}`
    );
  });
});

test('HttpSharePointClient: listCases rejects an orderBy key with no internal column', async () => {
  const { client, calls } = emptyPageClient();

  await assert.rejects(
    () =>
      client.listCases(
        {},
        { listName: 'Cases-ExampleReview', orderBy: 'notAColumn' }
      ),
    /notAColumn/
  );
  assert.equal(calls.length, 0, 'no request is sent with an invalid $orderby');
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

test('HttpSharePointClient: countCases defaults to 0 for an unrecognised page shape', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(JSON.stringify({ not: 'a page' }), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const n = await client.countCases({}, { listName: 'Cases-ExampleReview' });
  assert.equal(n, 0);
});

test('HttpSharePointClient: countCases counts the legacy d.results page shape', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({ d: { results: [{ Id: 1 }, { Id: 2 }] } }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const n = await client.countCases({}, { listName: 'Cases-ExampleReview' });
  assert.equal(n, 2);
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
      respond: () => idPage(0),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.countCases(
    {
      awaitingResponsibleParty: false,
      hasOpenAppeal: true,
      outcomeOverridden: false,
    },
    { listName: 'Cases-ExampleReview' }
  );

  const url = decodeURIComponent(calls[0].url);
  assert.ok(url.includes('AwaitingResponsibleParty eq 0'));
  assert.ok(url.includes('HasOpenAppeal eq 1'));
  assert.ok(url.includes('OutcomeOverridden eq 0'));
});

// --- Person columns in a filter ---

test('HttpSharePointClient: a responsibleParty filter compares against the numeric person id', async () => {
  // The column is a Person column, so the stored value is a number. Comparing
  // it to a quoted account name matches nothing, which reads as "you have no
  // Cases" rather than as a failure.
  const { fetch, calls } = peopleFilterFetch(
    { jrp: 27 },
    () =>
      new Response(
        JSON.stringify({
          value: [
            {
              Id: 'case-1',
              Title: 'One',
              Status: 'In-progress',
              CaseType: 'example-review',
              Answers: '{}',
              Conversation: '[]',
              Notes: '',
              CompletedAt: null,
            },
          ],
        }),
        { status: 200 }
      )
  );
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const rows = await client.listCases(
    { responsibleParty: 'jrp' },
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(rows.length, 1);
  const url = decodeURIComponent(
    String(calls.find((c) => c.url.includes('/items?'))?.url)
  );
  assert.ok(url.includes('ResponsiblePartyId eq 27'));
  assert.ok(!url.includes("eq '27'"), 'a quoted number is not a person id');
  assert.ok(!url.includes('jrp'), 'the account name never reaches the query');
});

test('HttpSharePointClient: an assignedReviewer count filter compares against the numeric person id', async () => {
  const { fetch, calls } = peopleFilterFetch({ jrev: 8 }, () => idPage(3));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const count = await client.countCases(
    { assignedReviewer: 'jrev' },
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(count, 3);
  const url = decodeURIComponent(
    String(calls.find((c) => c.url.includes('/items?'))?.url)
  );
  assert.ok(url.includes('AssignedReviewerId eq 8'));
  assert.ok(!url.includes("eq '8'"));
});

test('HttpSharePointClient: people inside an anyOf branch are resolved too', async () => {
  // The Action Centre really does build an anyOf of per-reason filters, so a
  // resolver that only looked at the top level would leave those branches
  // matching nothing.
  const { fetch, calls } = peopleFilterFetch({ a: 3, b: 4 });
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.listCases(
    { anyOf: [{ assignedReviewer: 'a' }, { responsibleParty: 'b' }] },
    { listName: 'Cases-ExampleReview' }
  );

  const url = decodeURIComponent(
    String(calls.find((c) => c.url.includes('/items?'))?.url)
  );
  assert.ok(
    url.includes('(AssignedReviewerId eq 3) or (ResponsiblePartyId eq 4)')
  );
});

test('HttpSharePointClient: one account is resolved once across a list and a count', async () => {
  const { fetch, calls } = peopleFilterFetch({ jrev: 8 }, () => idPage(0));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.listCases(
    { assignedReviewer: 'jrev' },
    { listName: 'Cases-ExampleReview' }
  );
  await client.countCases(
    { assignedReviewer: 'jrev' },
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(
    calls.filter((c) => c.url.endsWith('/_api/web/ensureuser')).length,
    1,
    'a dashboard refresh must not pay a directory round trip per panel'
  );
});

test('HttpSharePointClient: an unresolvable account fails the query rather than widening it', async () => {
  const { fetch, calls } = peopleFilterFetch({});
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await assert.rejects(() =>
    client.listCases(
      { assignedReviewer: 'ghost' },
      { listName: 'Cases-ExampleReview' }
    )
  );
  assert.equal(
    calls.find((c) => c.url.includes('/items?')),
    undefined,
    'no rows are read when the filter could not be built'
  );
});

test('HttpSharePointClient: the signed-in user is already resolved, so a filter on them asks nothing', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/web/currentUser'),
      respond: () =>
        new Response(
          JSON.stringify({
            LoginName: 'i:0#.w|CONTOSO\\jrev',
            Title: 'Jordan Reviewer',
            Id: 12,
          }),
          { status: 200 }
        ),
    },
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

  const user = await client.getCurrentUser();
  await client.listCases(
    { assignedReviewer: user.id },
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(
    calls.find((c) => c.url.endsWith('/_api/web/ensureuser')),
    undefined,
    'the id came back with the user'
  );
  const url = decodeURIComponent(
    String(calls.find((c) => c.url.includes('/items?'))?.url)
  );
  assert.ok(url.includes('AssignedReviewerId eq 12'));
});

test('HttpSharePointClient: a zero id on the current user is discarded, not cached', async () => {
  // `Number(null)` is 0 and 0 is finite, so a malformed currentUser response
  // could otherwise seed the id cache with a falsy value — and a falsy person
  // id later drops its condition from a filter, silently widening "my Cases"
  // to every Case. Discarding the zero costs one EnsureUser on the next
  // person filter, and EnsureUser validates its own answer.
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/web/currentUser'),
      respond: () =>
        new Response(
          JSON.stringify({
            LoginName: 'i:0#.w|CONTOSO\\jrev',
            Title: 'Jordan Reviewer',
            Id: 0,
          }),
          { status: 200 }
        ),
    },
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () =>
        new Response(JSON.stringify({ FormDigestValue: 'd' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    },
    {
      when: (c) => c.url.endsWith('/_api/web/ensureuser'),
      respond: () =>
        new Response(JSON.stringify({ Id: 12 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    },
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

  const user = await client.getCurrentUser();
  await client.listCases(
    { assignedReviewer: user.id },
    { listName: 'Cases-ExampleReview' }
  );

  const url = decodeURIComponent(
    String(calls.find((c) => c.url.includes('/items?'))?.url)
  );
  assert.ok(
    url.includes('AssignedReviewerId eq 12'),
    'the person condition survives, resolved the slow way'
  );
});
