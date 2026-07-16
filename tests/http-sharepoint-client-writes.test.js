// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import {
  WEB_URL,
  digestResponse,
  makeFetch,
} from './helpers/http-sharepoint-client.js';

// Capability: case serialization, writes, and optimistic concurrency.

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
  await client.patchCase('case-1', { details }, '"v1"', {
    listName: 'Cases-ExampleReview',
  });

  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch, 'PATCH was issued');
  const body = JSON.parse(String(patch.body));
  assert.equal(body.Details, JSON.stringify(details));
});

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

  await client.patchCase('case-1', { notes: 'n' }, '"v1"', {
    listName: 'Cases-ExampleReview',
  });

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
    '"v1"',
    { listName: 'Cases-ExampleReview' }
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

test('HttpSharePointClient: patchCase writes Action Centre state flags + clocks to SP columns', async () => {
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

  await client.patchCase(
    'case-1',
    {
      awaitingResponsibleParty: true,
      awaitingSince: '2026-07-05T09:00:00.000Z',
      reviewRequired: false,
      hasOpenAppeal: true,
      appealRaisedAt: '2026-07-05T10:00:00.000Z',
      reopened: false,
      reopenedAt: null,
    },
    '"v1"',
    { listName: 'Cases-ExampleReview' }
  );

  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch, 'PATCH was issued');
  const body = JSON.parse(String(patch.body));
  assert.deepEqual(body, {
    AwaitingResponsibleParty: true,
    AwaitingSince: '2026-07-05T09:00:00.000Z',
    ReviewRequired: false,
    HasOpenAppeal: true,
    AppealRaisedAt: '2026-07-05T10:00:00.000Z',
    Reopened: false,
    ReopenedAt: null,
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

  const result = await client.patchCase('case-1', { notes: 'n' }, '"v1"', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data?.etag, '"server-new"');
});

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

  const result = await client.patchCase('case-1', { notes: 'n' }, '"v1"', {
    listName: 'Cases-ExampleReview',
  });
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
    '"etag-1"',
    { listName: 'Cases-ExampleReview' }
  );
  const patchCall = calls.find((c) => c.method === 'PATCH');
  const body = JSON.parse(patchCall?.body ?? '{}');
  assert.equal(body.AssignedReviewerManager, 'mgr-r');
  assert.equal(body.ResponsiblePartyManager, 'mgr-rp');
});

test('HttpSharePointClient: patchCase throws when called without a listName', async () => {
  const { fetch, calls } = makeFetch([]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await assert.rejects(
    () => client.patchCase('case-1', { notes: 'x' }, '"v1"'),
    /listName is required/
  );
  assert.equal(calls.length, 0, 'no fetch attempted');
});

test('HttpSharePointClient: patchCase returns 404 when the 204-write case has vanished on refetch', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d'),
    },
    {
      when: (c) => c.method === 'PATCH',
      respond: () => new Response(null, { status: 204 }),
    },
    {
      when: (c) => c.method === 'GET',
      respond: () => new Response('not found', { status: 404 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await client.patchCase('case-1', { notes: 'n' }, '"v1"', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test('HttpSharePointClient: patchCase 200 response with neither an ETag header nor an odata.etag field falls back through the || to the same empty row etag', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d'),
    },
    {
      when: (c) => c.method === 'PATCH',
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
          { status: 200 } // no ETag header, no odata.etag field — readEtag(data) is ''
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await client.patchCase('case-1', { notes: 'n' }, '"v1"', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data?.etag, '');
});

test('HttpSharePointClient: patchCase surfaces a network error without a status as {ok:false, status:500}', async () => {
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });

  const result = await client.patchCase('case-1', { notes: 'n' }, '"v1"', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
});

test('HttpSharePointClient: patchCase writes status, assignedReviewer, responsibleParty, answers and conversation to SP columns', async () => {
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

  const answers = { 'q-1': { value: 'Yes' } };
  const conversation = [{ author: 'u1', timestamp: 't', body: 'hi' }];
  await client.patchCase(
    'case-1',
    {
      status: 'Completed',
      assignedReviewer: 'user-9',
      responsibleParty: 'user-10',
      answers,
      conversation,
    },
    '"v1"',
    { listName: 'Cases-ExampleReview' }
  );

  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch, 'PATCH was issued');
  const body = JSON.parse(String(patch.body));
  assert.equal(body.Status, 'Completed');
  assert.equal(body.AssignedReviewerId, 'user-9');
  assert.equal(body.ResponsiblePartyId, 'user-10');
  assert.equal(body.Answers, JSON.stringify(answers));
  assert.equal(body.Conversation, JSON.stringify(conversation));
});
