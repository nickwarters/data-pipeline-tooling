// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import { WEB_URL, makeFetch } from './helpers/http-sharepoint-client.js';

// Capability: case reads, hydration, and derived fields.

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

  const row = await client.getCase('case-1', {
    listName: 'Cases-ExampleReview',
  });

  assert.deepEqual(row?.details, {
    customerName: 'Jordan Lee',
    accountNumber: 'ACC-4471',
  });
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

  const row = await client.getCase('case-bad', {
    listName: 'Cases-ExampleReview',
  });

  assert.deepEqual(row?.answers, {}, 'invalid Answers JSON falls back to {}');
  assert.deepEqual(
    row?.conversation,
    [],
    'invalid Conversation JSON falls back to []'
  );
});

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

  const row = await client.getCase('case-missing', {
    listName: 'Cases-ExampleReview',
  });
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
            AssignedReviewer: { Name: 'i:0#.w|CONTOSO\\user-1' },
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

  const row = await client.getCase('case-1', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(row?.id, 'case-1');
  assert.equal(row?.etag, '"v7"');
  assert.equal(row?.answers['q-welcome']?.value, 'Yes');
  assert.equal(row?.conversation.length, 1);
  assert.equal(row?.assignedReviewer, 'user-1');
});

test('HttpSharePointClient: listCases rows carry an empty etag', async () => {
  // A collection response the way SharePoint answers this client: the reads ask
  // for JSON without metadata annotations, so there is no per-item `odata.etag`
  // — and no response-level `ETag` header either, since the payload is many
  // rows rather than one. A caller that needs an `If-Match` has to read the
  // single row for it.
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            value: [
              {
                Id: 'case-1',
                Title: 'One',
                Status: 'In-progress',
                CaseType: 'example-review',
                AssignedReviewerId: 'u1',
                ResponsiblePartyId: 'u2',
                Answers: '{}',
                Conversation: '[]',
                Notes: '',
                CompletedAt: null,
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

  const rows = await client.listCases({}, { listName: 'Cases-ExampleReview' });

  assert.equal(rows[0].etag, '');
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
            AssignedReviewer: { Name: 'i:0#.w|CONTOSO\\reviewer-1' },
            AssignedReviewerManager: {
              Name: 'i:0#.w|CONTOSO\\reviewer-manager',
            },
            ResponsibleParty: { Name: 'i:0#.w|CONTOSO\\rp-1' },
            ResponsiblePartyManager: { Name: 'i:0#.w|CONTOSO\\rp-manager' },
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
            AssignedAt: '2026-06-01T11:00:00.000Z',
            OnHold: true,
            PlacedOnHoldAt: '2026-06-05T10:00:00.000Z',
            Created: '2026-06-01T09:00:00.000Z',
          }),
          { status: 200, headers: { ETag: '"v7"' } }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const row = await client.getCase('case-1', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(row?.assignedReviewer, 'reviewer-1');
  assert.equal(row?.assignedAt, '2026-06-01T11:00:00.000Z');
  assert.equal(row?.assignedReviewerManager, 'reviewer-manager');
  assert.equal(row?.responsibleParty, 'rp-1');
  assert.equal(row?.responsiblePartyManager, 'rp-manager');
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
  assert.equal(row?.onHold, true);
  assert.equal(row?.placedOnHoldAt, '2026-06-05T10:00:00.000Z');
  assert.equal(row?.created, '2026-06-01T09:00:00.000Z');
  assert.equal(row?.overdue, false);
});

test('HttpSharePointClient: a row from a list with no AssignedAt column still reads', async () => {
  // The read projection is `$select=*`, so a list that has not been given the
  // column yet simply answers without it. That is what makes deploying the
  // frontend ahead of the column safe on the *read* side: the row hydrates with
  // no assignment time rather than failing.
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-1',
            Title: 'Unprovisioned list',
            Status: 'In-progress',
            CaseType: 'example-review',
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

  const row = await client.getCase('case-1', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(row?.assignedAt, null);
});

test('HttpSharePointClient: listCases derives overdue from the hydrated default status', async () => {
  const rawRow = {
    Id: 'case-1',
    Overdue: false,
    DueDate: '2020-01-01T00:00:00.000Z',
  };
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(JSON.stringify({ value: [rawRow] }), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const rows = await client.listCases(
    {},
    {
      listName: 'Cases-ExampleReview',
    }
  );

  assert.equal(rows[0].status, 'In-progress');
  assert.equal(rows[0].overdue, true);
});

test('HttpSharePointClient: getCase reads both managers as account names, not lookup ids', async () => {
  // The manager columns are Person columns like the other two, and Section
  // access matches the Reviewer Manager and Responsible Party Manager Roles
  // against the signed-in user's bare account — a row carrying anything else
  // silently disables both Roles.
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-x',
            Title: 'X',
            Status: 'In-progress',
            CaseType: 'example-review',
            // The numbers the unexpanded read would have handed back, left
            // here on purpose: taking either would look like it worked.
            AssignedReviewerManagerId: 44,
            ResponsiblePartyManagerId: 45,
            AssignedReviewerManager: { Name: 'i:0#.w|CONTOSO\\mgr-r' },
            ResponsiblePartyManager: { Name: 'i:0#.w|CONTOSO\\mgr-rp' },
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
  const row = await client.getCase('case-x', {
    listName: 'Cases-ExampleReview',
  });
  assert.equal(row?.assignedReviewerManager, 'mgr-r');
  assert.equal(row?.responsiblePartyManager, 'mgr-rp');
  const url = decodeURIComponent(calls[0].url);
  // Asserted as the whole expand list, not a prefix: a person column dropped
  // off the end costs no error and no empty column, only a row that quietly
  // reads as having nobody in that role.
  assert.ok(
    url.includes(
      '$expand=AssignedReviewer,ResponsibleParty,AssignedReviewerManager,ResponsiblePartyManager,VoidedBy'
    ),
    'every person column must be expanded for its account name'
  );
  for (const column of [
    'AssignedReviewer',
    'ResponsibleParty',
    'AssignedReviewerManager',
    'ResponsiblePartyManager',
    'VoidedBy',
  ]) {
    assert.ok(
      url.includes(`${column}/Name`),
      `${column}/Name must be selected, or the expanded entity carries no account`
    );
  }
});

test('HttpSharePointClient: a Case with no managers reads them as absent, not empty accounts', async () => {
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
            AssignedReviewerManager: null,
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
  const row = await client.getCase('case-x', {
    listName: 'Cases-ExampleReview',
  });
  assert.equal(row?.assignedReviewerManager, undefined);
  assert.equal(row?.responsiblePartyManager, undefined);
});

test('HttpSharePointClient: getCase reads the Responsible Party as an account name, not a lookup id', async () => {
  // The column is a Person column, so SharePoint answers with the numeric User
  // Information List id unless the lookup is expanded. That number is local to
  // one site collection; the app keys identity on the bare account name, and
  // Section access matches the Responsible Party Role on it.
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-rp',
            Title: 'T',
            Status: 'In-progress',
            CaseType: 'example-review',
            AssignedReviewerId: 'user-r',
            ResponsiblePartyId: 27,
            ResponsibleParty: {
              Name: 'i:0#.w|CONTOSO\\jrp',
              Title: 'Jordan RP',
            },
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

  const row = await client.getCase('case-rp', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(row?.responsibleParty, 'jrp');
  assert.equal(row?.responsiblePartyDisplayName, 'Jordan RP');
  const url = decodeURIComponent(calls[0].url);
  assert.ok(
    url.includes('$expand=AssignedReviewer,ResponsibleParty'),
    'the read must expand the person for the account name to be there at all'
  );
  assert.ok(
    url.includes('$select=*'),
    'and keep every other column the read returned before'
  );
});

test('HttpSharePointClient: a Case with nobody responsible reads as an empty account', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-none',
            Title: 'T',
            Status: 'In-progress',
            CaseType: 'example-review',
            ResponsibleParty: null,
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

  const row = await client.getCase('case-none', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(row?.responsibleParty, '');
  assert.equal(row?.responsiblePartyDisplayName, undefined);
});

test('HttpSharePointClient: getCase reads the Assigned Reviewer as an account name, not a lookup id', async () => {
  // The same Person column story as the Responsible Party: the flat `…Id` is a
  // site-local number, and the app matches the Assigned Reviewer Role — which
  // grants edit on the Issues tab — against the signed-in user's bare account.
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-ar',
            Title: 'T',
            Status: 'In-progress',
            CaseType: 'example-review',
            // The number the unexpanded read would have handed back, left here
            // on purpose: taking it would look like a working account name.
            AssignedReviewerId: 27,
            AssignedReviewer: {
              Name: 'i:0#.w|CONTOSO\\jrev',
              Title: 'Jordan Reviewer',
            },
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

  const row = await client.getCase('case-ar', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(row?.assignedReviewer, 'jrev');
  const url = decodeURIComponent(calls[0].url);
  assert.ok(
    url.includes('$expand=AssignedReviewer,ResponsibleParty'),
    'both person columns must be expanded for either account name to be there'
  );
  assert.ok(
    url.includes('$select=*'),
    'and keep every other column the read returned before'
  );
});

test('HttpSharePointClient: a Case with nobody assigned reads as an empty account', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-none',
            Title: 'T',
            Status: 'In-progress',
            CaseType: 'example-review',
            AssignedReviewer: null,
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

  const row = await client.getCase('case-none', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(row?.assignedReviewer, '');
});

test('HttpSharePointClient: listCases expands both person columns on every row', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            value: [
              {
                Id: 'case-1',
                Title: 'One',
                Status: 'In-progress',
                CaseType: 'example-review',
                AssignedReviewer: {
                  Name: 'i:0#.w|CONTOSO\\jrev',
                  Title: 'Jordan Reviewer',
                },
                ResponsibleParty: {
                  Name: 'i:0#.w|CONTOSO\\jrp',
                  Title: 'Jordan RP',
                },
                Answers: '{}',
                Conversation: '[]',
                Notes: '',
                CompletedAt: null,
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

  const rows = await client.listCases({}, { listName: 'Cases-ExampleReview' });

  assert.equal(rows[0].assignedReviewer, 'jrev');
  assert.equal(rows[0].responsibleParty, 'jrp');
  assert.ok(
    decodeURIComponent(calls[0].url).includes(
      '$expand=AssignedReviewer,ResponsibleParty'
    )
  );
});

test('HttpSharePointClient: getCase throws when called without a listName', async () => {
  const { fetch, calls } = makeFetch([]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await assert.rejects(() => client.getCase('case-1'), /listName is required/);
  assert.equal(calls.length, 0, 'no fetch attempted');
});

test('HttpSharePointClient: getCase rethrows a non-404 fetch error', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => new Response('boom', { status: 500 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await assert.rejects(
    () => client.getCase('case-1', { listName: 'Cases-ExampleReview' }),
    /HTTP Error: 500/
  );
});

test('HttpSharePointClient: getCase falls back to an empty id when SP omits Id', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(JSON.stringify({ Title: 'No Id' }), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const row = await client.getCase('whatever', {
    listName: 'Cases-ExampleReview',
  });
  assert.equal(row?.id, '');
});

test('HttpSharePointClient: getCase passes through an already-parsed (non-string) Answers value unchanged', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-1',
            Title: 'T',
            Status: 'In-progress',
            Answers: { 'q-1': { value: 'Yes' } },
            Conversation: '[]',
            Notes: '',
            CompletedAt: null,
            CaseType: 'example-review',
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const row = await client.getCase('case-1', {
    listName: 'Cases-ExampleReview',
  });
  assert.deepEqual(row?.answers, { 'q-1': { value: 'Yes' } });
});

test('HttpSharePointClient: listCases maps the void columns onto the Case Row', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            value: [
              {
                Id: 'case-void',
                Title: 'Voided',
                Status: 'Void',
                CaseType: 'example-review',
                Answers: '{}',
                Conversation: '[]',
                Notes: '',
                CompletedAt: null,
                VoidReason: 'duplicate',
                VoidedAt: '2026-06-04T10:00:00.000Z',
                VoidedBy: { Name: 'i:0#.w|CONTOSO\\reviewer-1' },
              },
              {
                Id: 'case-live',
                Title: 'Live',
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
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const rows = await client.listCases({}, { listName: 'Cases-ExampleReview' });

  assert.equal(rows[0].voidReason, 'duplicate');
  assert.equal(rows[0].voidedAt, '2026-06-04T10:00:00.000Z');
  assert.equal(rows[0].voidedBy, 'reviewer-1');
  // A list that has not been given the columns yet still hydrates.
  assert.equal(rows[1].voidReason, undefined);
  assert.equal(rows[1].voidedAt, null);
  assert.equal(rows[1].voidedBy, undefined);
});
