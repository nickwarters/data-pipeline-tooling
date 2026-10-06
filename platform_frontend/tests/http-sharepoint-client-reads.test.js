// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import {
  PERSON_COLUMNS,
  WEB_URL,
  caseRowResponse,
  makeFetch,
  readsClient,
} from './helpers/http-sharepoint-client.js';

// Capability: case reads, hydration, and derived fields.

test('HttpSharePointClient: Person-column metadata includes every required unique mapping', () => {
  const requiredMappings = [
    ['assignedReviewer', 'AssignedReviewer', 'AssignedReviewerId'],
    ['responsibleParty', 'ResponsibleParty', 'ResponsiblePartyId'],
    [
      'assignedReviewerManager',
      'AssignedReviewerManager',
      'AssignedReviewerManagerId',
    ],
    [
      'responsiblePartyManager',
      'ResponsiblePartyManager',
      'ResponsiblePartyManagerId',
    ],
    ['voidedBy', 'VoidedBy', 'VoidedById'],
  ];
  assert.ok(PERSON_COLUMNS.length >= requiredMappings.length);
  for (const key of ['field', 'column', 'idColumn']) {
    assert.equal(
      new Set(
        PERSON_COLUMNS.map((mapping) => /** @type {any} */ (mapping)[key])
      ).size,
      PERSON_COLUMNS.length,
      `${key} values are unique`
    );
  }
  const mappings = new Set(
    PERSON_COLUMNS.map(({ field, column, idColumn }) =>
      [field, column, idColumn].join('|')
    )
  );
  for (const required of requiredMappings) {
    assert.ok(mappings.has(required.join('|')), `${required[0]} is registered`);
  }
});

test('HttpSharePointClient: getCase parses the Details JSON blob into CaseRow.details', async () => {
  const client = readsClient(
    caseRowResponse({
      Details: JSON.stringify({
        customerName: 'Jordan Lee',
        accountNumber: 'ACC-4471',
      }),
    })
  );

  const row = await client.getCase('case-1', {
    listName: 'Cases-ExampleReview',
  });

  assert.deepEqual(row?.details, {
    customerName: 'Jordan Lee',
    accountNumber: 'ACC-4471',
  });
});

test('HttpSharePointClient: getCase returns fallback empty objects when Answers/Conversation are invalid JSON', async () => {
  const client = readsClient(
    caseRowResponse({
      Id: 'case-bad',
      Title: 'Bad JSON',
      Answers: 'not valid json {{{',
      Conversation: 'also invalid',
    })
  );

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
          JSON.stringify(
            caseRowResponse({
              Id: 'case-1',
              Title: 'Hello',
              AssignedReviewer: { Name: 'i:0#.w|CONTOSO\\user-1' },
              ResponsiblePartyId: 'user-2',
              Answers: JSON.stringify({ 'q-welcome': { value: 'Yes' } }),
              Conversation: JSON.stringify([
                {
                  author: { loginName: 'user-1', displayName: 'User One' },
                  timestamp: 't',
                  body: 'hi',
                },
              ]),
              Notes: 'note',
            })
          ),
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
  const client = readsClient(caseRowResponse({ Title: 'One' }));

  const rows = await client.listCases({}, { listName: 'Cases-ExampleReview' });

  assert.equal(rows[0].etag, '');
});

test('HttpSharePointClient: getCase can target a supplied SharePoint list', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify(
            caseRowResponse({
              Id: 'case-1',
              Title: 'Complaint Case',
              CaseType: 'product-sale-review',
            })
          ),
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
  const client = readsClient(
    caseRowResponse({
      Id: 'case-1',
      Title: 'Full row',
      Status: 'Completed',
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
    })
  );

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

test('HttpSharePointClient: a legacy row missing AssignedAt hydrates it as null', async () => {
  // A historical item can omit the value even after the column is provisioned;
  // hydration normalises that omitted property to the mock's explicit-null shape.
  const client = readsClient(caseRowResponse({ Title: 'Unprovisioned list' }));

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

for (const { field, column, idColumn, emptyValue } of PERSON_COLUMNS) {
  test(`HttpSharePointClient: listCases reads ${field} as a bare account name`, async () => {
    const client = readsClient(
      caseRowResponse({
        [idColumn]: 27,
        [column]: { Name: 'i:0#.w|CONTOSO\\jsmith' },
      })
    );

    const [row] = await client.listCases(
      {},
      { listName: 'Cases-ExampleReview' }
    );

    assert.equal(/** @type {any} */ (row)[field], 'jsmith');
    assert.notEqual(/** @type {any} */ (row)[field], 27);
  });

  test(`HttpSharePointClient: listCases preserves empty ${field} semantics`, async () => {
    const client = readsClient(
      caseRowResponse({ [idColumn]: null, [column]: null })
    );

    const [row] = await client.listCases(
      {},
      { listName: 'Cases-ExampleReview' }
    );

    assert.equal(/** @type {any} */ (row)[field], emptyValue);
  });
}

test('HttpSharePointClient: a Case with nobody responsible has no display name', async () => {
  const client = readsClient(
    caseRowResponse({ ResponsiblePartyId: null, ResponsibleParty: null })
  );

  const [row] = await client.listCases({}, { listName: 'Cases-ExampleReview' });

  assert.equal(row.responsiblePartyDisplayName, undefined);
});

test('HttpSharePointClient: getCase and listCases project every Person column', async () => {
  const item = caseRowResponse({
    AssignedReviewer: { Name: 'i:0#.w|CONTOSO\\reviewer' },
    ResponsibleParty: {
      Name: 'i:0#.w|CONTOSO\\responsible',
      Title: 'Responsible Person',
    },
    AssignedReviewerManager: { Name: 'i:0#.w|CONTOSO\\reviewer-manager' },
    ResponsiblePartyManager: {
      Name: 'i:0#.w|CONTOSO\\responsible-manager',
    },
    VoidedBy: { Name: 'i:0#.w|CONTOSO\\voider' },
  });
  const { fetch, calls } = makeFetch([
    {
      when: (call) => call.method === 'GET' && call.url.includes('/items('),
      respond: () => new Response(JSON.stringify(item), { status: 200 }),
    },
    {
      when: (call) => call.method === 'GET',
      respond: () =>
        new Response(JSON.stringify({ value: [item] }), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const row = await client.getCase('case-1', {
    listName: 'Cases-ExampleReview',
  });
  const [listed] = await client.listCases(
    {},
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(row?.responsiblePartyDisplayName, 'Responsible Person');
  assert.equal(listed.responsiblePartyDisplayName, 'Responsible Person');
  assert.equal(calls.length, 2);
  const projectedColumns = PERSON_COLUMNS.map(({ column }) => column);
  const expectedExpand = projectedColumns;
  const expectedSelect = [
    '*',
    ...projectedColumns.flatMap((column) =>
      column === 'ResponsibleParty'
        ? [`${column}/Name`, `${column}/Title`]
        : [`${column}/Name`]
    ),
  ];
  for (const call of calls) {
    const query = new URL(call.url).searchParams;
    assert.deepEqual(query.get('$expand')?.split(','), expectedExpand);
    assert.deepEqual(query.get('$select')?.split(','), expectedSelect);
  }
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
  const client = readsClient(
    caseRowResponse({ Answers: { 'q-1': { value: 'Yes' } } })
  );

  const row = await client.getCase('case-1', {
    listName: 'Cases-ExampleReview',
  });
  assert.deepEqual(row?.answers, { 'q-1': { value: 'Yes' } });
});

test('HttpSharePointClient: listCases maps the void columns onto the Case Row', async () => {
  const client = readsClient(
    caseRowResponse({
      Id: 'case-void',
      Title: 'Voided',
      Status: 'Void',
      VoidReason: 'other',
      VoidReasonNote: 'The file was destroyed in the flood',
      VoidedAt: '2026-06-04T10:00:00.000Z',
      VoidedBy: { Name: 'i:0#.w|CONTOSO\\reviewer-1' },
    }),
    caseRowResponse({ Id: 'case-live', Title: 'Live' })
  );

  const rows = await client.listCases({}, { listName: 'Cases-ExampleReview' });

  assert.equal(rows[0].voidReason, 'other');
  assert.equal(rows[0].voidReasonNote, 'The file was destroyed in the flood');
  assert.equal(rows[0].voidedAt, '2026-06-04T10:00:00.000Z');
  assert.equal(rows[0].voidedBy, 'reviewer-1');
  // A list that has not been given the columns yet still hydrates.
  assert.equal(rows[1].voidReason, undefined);
  assert.equal(rows[1].voidReasonNote, undefined);
  assert.equal(rows[1].voidedAt, null);
  assert.equal(rows[1].voidedBy, undefined);
});
