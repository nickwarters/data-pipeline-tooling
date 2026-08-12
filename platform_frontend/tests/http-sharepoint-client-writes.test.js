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
      when: (c) => c.url.endsWith('/_api/web/ensureuser'),
      respond: () =>
        new Response(JSON.stringify({ Id: 21 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
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
      onHold: true,
      placedOnHoldAt: '2026-07-23T09:30:00.000Z',
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
    OnHold: true,
    PlacedOnHoldAt: '2026-07-23T09:30:00.000Z',
    AssignedReviewerManagerId: null,
    ResponsiblePartyManagerId: 21,
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

test('HttpSharePointClient: writing the managers resolves each account to its numeric id', async () => {
  // The manager columns are Person columns like the other two: SharePoint
  // takes the id, and the account string it would otherwise receive is an
  // invalid person value that fails the save.
  const { fetch, calls } = personWriteFetch(ensureUserResponse(14));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await client.patchCase(
    'case-1',
    { assignedReviewerManager: 'jsmith', responsiblePartyManager: 'jsmith' },
    '"v1"',
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(result.ok, true);
  const body = JSON.parse(
    String(calls.find((c) => c.method === 'PATCH')?.body)
  );
  assert.equal(body.AssignedReviewerManagerId, 14);
  assert.equal(body.ResponsiblePartyManagerId, 14);
  assert.ok(
    !('AssignedReviewerManager' in body) &&
      !('ResponsiblePartyManager' in body),
    'the account string never reaches a Person column'
  );
  assert.equal(
    calls.filter((c) => c.url.endsWith('/_api/web/ensureuser')).length,
    1,
    'one account is one lookup, whichever columns it lands in'
  );
});

test('HttpSharePointClient: clearing the managers writes null, whichever way nobody is spelled', async () => {
  // The row speaks both dialects — the managers allow an explicit null where
  // the other two person fields use the empty string — and SharePoint clears
  // a Person column with null either way.
  const { fetch, calls } = personWriteFetch(ensureUserResponse(14));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.patchCase(
    'case-1',
    { assignedReviewerManager: null, responsiblePartyManager: '' },
    '"v1"',
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(
    calls.find((c) => c.url.endsWith('/_api/web/ensureuser')),
    undefined,
    'there is no account to resolve'
  );
  const body = JSON.parse(
    String(calls.find((c) => c.method === 'PATCH')?.body)
  );
  assert.equal(body.AssignedReviewerManagerId, null);
  assert.equal(body.ResponsiblePartyManagerId, null);
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

test('HttpSharePointClient: patchCase writes status, answers and conversation to SP columns', async () => {
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
  assert.equal(body.Answers, JSON.stringify(answers));
  assert.equal(body.Conversation, JSON.stringify(conversation));
});

// --- The Responsible Party person column ---

/**
 * A fake backing a Responsible Party write: the digest, an EnsureUser that
 * answers with `ensured`, the PATCH itself, and the confirmation re-read.
 *
 * @param {Response | (() => Response) | null} ensured the EnsureUser response,
 *   or null to fail it
 */
function personWriteFetch(ensured) {
  return makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d'),
    },
    {
      when: (c) => c.url.endsWith('/_api/web/ensureuser'),
      respond: () =>
        (typeof ensured === 'function' ? ensured() : ensured) ??
        new Response('no such user', { status: 500 }),
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
            CaseType: 'example-review',
            ResponsibleParty: {
              Name: 'i:0#.w|CONTOSO\\jsmith',
              Title: 'John Smith',
            },
            Answers: '{}',
            Conversation: '[]',
            Notes: '',
            CompletedAt: null,
          }),
          { status: 200, headers: { ETag: '"v2"' } }
        ),
    },
  ]);
}

/** @param {number} id */
function ensureUserResponse(id) {
  return new Response(JSON.stringify({ Id: id, Title: 'John Smith' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('HttpSharePointClient: writing the Responsible Party resolves the account to its numeric id', async () => {
  // A Person column is written by id, not by name, so the account the app holds
  // has to be turned into one first. EnsureUser is also what adds a directory
  // user to this site's User Information List if they are not in it yet.
  const { fetch, calls } = personWriteFetch(ensureUserResponse(14));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await client.patchCase(
    'case-1',
    { responsibleParty: 'jsmith' },
    '"v1"',
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(result.ok, true);
  const ensure = calls.find((c) => c.url.endsWith('/_api/web/ensureuser'));
  assert.ok(ensure, 'EnsureUser was called');
  assert.equal(ensure.method, 'POST');
  assert.deepEqual(JSON.parse(String(ensure.body)), {
    logonName: 'i:0#.w|CONTOSO\\jsmith',
  });

  const patch = calls.find((c) => c.method === 'PATCH');
  const body = JSON.parse(String(patch?.body));
  assert.equal(body.ResponsiblePartyId, 14);
  assert.equal(
    typeof body.ResponsiblePartyId,
    'number',
    'a quoted id is rejected by SharePoint as an invalid person value'
  );
});

test('HttpSharePointClient: an account is resolved once and reused for later saves', async () => {
  const { fetch, calls } = personWriteFetch(ensureUserResponse(14));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.patchCase('case-1', { responsibleParty: 'jsmith' }, '"v1"', {
    listName: 'Cases-ExampleReview',
  });
  await client.patchCase('case-1', { responsibleParty: 'jsmith' }, '"v2"', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(
    calls.filter((c) => c.url.endsWith('/_api/web/ensureuser')).length,
    1,
    'a debounced save must not pay a directory round trip every time'
  );
});

test('HttpSharePointClient: clearing the Responsible Party writes null, not an empty account', async () => {
  const { fetch, calls } = personWriteFetch(ensureUserResponse(14));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.patchCase('case-1', { responsibleParty: '' }, '"v1"', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(
    calls.find((c) => c.url.endsWith('/_api/web/ensureuser')),
    undefined,
    'there is no account to resolve'
  );
  const body = JSON.parse(
    String(calls.find((c) => c.method === 'PATCH')?.body)
  );
  assert.equal(body.ResponsiblePartyId, null);
});

test('HttpSharePointClient: an unresolvable account fails the save instead of writing a wrong one', async () => {
  const { fetch, calls } = personWriteFetch(null);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await client.patchCase(
    'case-1',
    { responsibleParty: 'nobody' },
    '"v1"',
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(
    calls.find((c) => c.method === 'PATCH'),
    undefined,
    'nothing is written when the account cannot be resolved'
  );
});

test('HttpSharePointClient: an EnsureUser answer with no id is a failed save, not a NaN write', async () => {
  const { fetch, calls } = personWriteFetch(
    new Response(JSON.stringify({ Title: 'John Smith' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await client.patchCase(
    'case-1',
    { responsibleParty: 'jsmith' },
    '"v1"',
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(
    calls.find((c) => c.method === 'PATCH'),
    undefined
  );
});

test('HttpSharePointClient: a legacy verbose EnsureUser envelope still yields the id', async () => {
  const { fetch, calls } = personWriteFetch(
    new Response(JSON.stringify({ d: { Id: 21 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.patchCase('case-1', { responsibleParty: 'jsmith' }, '"v1"', {
    listName: 'Cases-ExampleReview',
  });

  const body = JSON.parse(
    String(calls.find((c) => c.method === 'PATCH')?.body)
  );
  assert.equal(body.ResponsiblePartyId, 21);
});

// --- The Assigned Reviewer person column ---

test('HttpSharePointClient: writing the Assigned Reviewer resolves the account to its numeric id', async () => {
  // Self-allocation writes this field today, so the wrong shape here is a live
  // failed save rather than a latent one.
  const { fetch, calls } = personWriteFetch(ensureUserResponse(14));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await client.patchCase(
    'case-1',
    { assignedReviewer: 'jsmith' },
    '"v1"',
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(result.ok, true);
  const ensure = calls.find((c) => c.url.endsWith('/_api/web/ensureuser'));
  assert.ok(ensure, 'EnsureUser was called');
  assert.equal(ensure.method, 'POST');
  assert.deepEqual(JSON.parse(String(ensure.body)), {
    logonName: 'i:0#.w|CONTOSO\\jsmith',
  });

  const patch = calls.find((c) => c.method === 'PATCH');
  const body = JSON.parse(String(patch?.body));
  assert.equal(body.AssignedReviewerId, 14);
  assert.equal(
    typeof body.AssignedReviewerId,
    'number',
    'a quoted id is rejected by SharePoint as an invalid person value'
  );
});

test('HttpSharePointClient: allocation writes Reviewer and manager as Person ids in one PATCH', async () => {
  let nextPersonId = 14;
  const { fetch, calls } = personWriteFetch(() =>
    ensureUserResponse(nextPersonId++)
  );
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
    now: frozenNow,
  });

  const result = await client.patchCase(
    'case-1',
    { assignedReviewer: 'jsmith', assignedReviewerManager: 'manager-1' },
    '"v1"',
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(result.ok, true);
  const ensuredLogins = calls
    .filter((call) => call.url.endsWith('/_api/web/ensureuser'))
    .map((call) => JSON.parse(String(call.body)).logonName);
  const reviewerLogin = 'i:0#.w|CONTOSO\\jsmith';
  const managerLogin = 'i:0#.w|CONTOSO\\manager-1';
  assert.deepEqual(
    [...ensuredLogins].sort(),
    [reviewerLogin, managerLogin].sort()
  );
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 1);
  assert.deepEqual(patchBody(calls), {
    AssignedReviewerId: 14 + ensuredLogins.indexOf(reviewerLogin),
    AssignedReviewerManagerId: 14 + ensuredLogins.indexOf(managerLogin),
    AssignedAt: FROZEN_ASSIGNMENT,
  });
});

test('HttpSharePointClient: clearing the Assigned Reviewer writes null, not an empty account', async () => {
  const { fetch, calls } = personWriteFetch(ensureUserResponse(14));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.patchCase('case-1', { assignedReviewer: '' }, '"v1"', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(
    calls.find((c) => c.url.endsWith('/_api/web/ensureuser')),
    undefined,
    'there is no account to resolve'
  );
  const body = JSON.parse(
    String(calls.find((c) => c.method === 'PATCH')?.body)
  );
  assert.equal(body.AssignedReviewerId, null);
});

test('HttpSharePointClient: allocation with a null manager omits manager EnsureUser and writes explicit null', async () => {
  const { fetch, calls } = personWriteFetch(ensureUserResponse(14));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
    now: frozenNow,
  });

  const result = await client.patchCase(
    'case-1',
    { assignedReviewer: 'jsmith', assignedReviewerManager: null },
    '"v1"',
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(result.ok, true);
  assert.equal(
    calls.filter((call) => call.url.endsWith('/_api/web/ensureuser')).length,
    1
  );
  assert.deepEqual(patchBody(calls), {
    AssignedReviewerId: 14,
    AssignedReviewerManagerId: null,
    AssignedAt: FROZEN_ASSIGNMENT,
  });
});

const FROZEN_ASSIGNMENT = '2026-08-01T09:30:00.000Z';
const frozenNow = () => new Date(FROZEN_ASSIGNMENT);

/** @param {{ method: string, body: string|null }[]} calls */
function patchBody(calls) {
  return JSON.parse(String(calls.find((c) => c.method === 'PATCH')?.body));
}

test('HttpSharePointClient: assigning a Reviewer stamps the assignment time', async () => {
  const { fetch, calls } = personWriteFetch(ensureUserResponse(14));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
    now: frozenNow,
  });

  await client.patchCase('case-1', { assignedReviewer: 'jsmith' }, '"v1"', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(patchBody(calls).AssignedAt, FROZEN_ASSIGNMENT);
});

test('HttpSharePointClient: clearing the Assigned Reviewer clears the assignment time', async () => {
  const { fetch, calls } = personWriteFetch(ensureUserResponse(14));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
    now: frozenNow,
  });

  await client.patchCase('case-1', { assignedReviewer: '' }, '"v1"', {
    listName: 'Cases-ExampleReview',
  });

  assert.equal(patchBody(calls).AssignedAt, null);
});

test('HttpSharePointClient: a save that names no Reviewer carries no assignment time at all', async () => {
  const { fetch, calls } = personWriteFetch(ensureUserResponse(14));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
    now: frozenNow,
  });

  await client.patchCase('case-1', { notes: 'x' }, '"v1"', {
    listName: 'Cases-ExampleReview',
  });

  // Absent, not null: an ordinary Notes or Answers save must not touch the
  // column, or every debounced save would restamp the assignment.
  assert.equal('AssignedAt' in patchBody(calls), false);
});

test('HttpSharePointClient: both person columns in one save resolve the shared account once', async () => {
  const { fetch, calls } = personWriteFetch(ensureUserResponse(14));
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.patchCase(
    'case-1',
    { assignedReviewer: 'jsmith', responsibleParty: 'jsmith' },
    '"v1"',
    { listName: 'Cases-ExampleReview' }
  );

  const body = JSON.parse(
    String(calls.find((c) => c.method === 'PATCH')?.body)
  );
  assert.equal(body.AssignedReviewerId, 14);
  assert.equal(body.ResponsiblePartyId, 14);
  assert.equal(
    calls.filter((c) => c.url.endsWith('/_api/web/ensureuser')).length,
    1,
    'one account is one lookup, whichever columns it lands in'
  );
});

test('HttpSharePointClient: an EnsureUser answer of zero is no person at all', async () => {
  // Ids are allocated from 1. Accepting a zero would put a falsy id into a
  // filter condition, where it reads as "nobody named" and drops the condition.
  const { fetch, calls } = personWriteFetch(
    new Response(JSON.stringify({ Id: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await client.patchCase(
    'case-1',
    { assignedReviewer: 'jsmith' },
    '"v1"',
    { listName: 'Cases-ExampleReview' }
  );

  assert.equal(result.ok, false);
  assert.equal(
    calls.find((c) => c.method === 'PATCH'),
    undefined
  );
});

test('HttpSharePointClient: patchCase writes the void columns, and omits them when absent', async () => {
  const respondToWrite = () => [
    {
      when: (/** @type {any} */ c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d'),
    },
    {
      when: (/** @type {any} */ c) => c.url.endsWith('/_api/web/ensureuser'),
      respond: () => ensureUserResponse(14),
    },
    {
      when: (/** @type {any} */ c) => c.method === 'PATCH',
      respond: () =>
        new Response(null, { status: 204, headers: { ETag: '"v2"' } }),
    },
    {
      when: (/** @type {any} */ c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-1',
            Title: 'T',
            Status: 'Void',
            Answers: '{}',
            Conversation: '[]',
            Notes: 'n',
            CompletedAt: null,
            CaseType: 'example-review',
          }),
          { status: 200, headers: { ETag: '"v2"' } }
        ),
    },
  ];

  const voided = makeFetch(respondToWrite());
  await new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: voided.fetch,
  }).patchCase(
    'case-1',
    {
      status: 'Void',
      voidReason: 'duplicate',
      voidedAt: '2026-07-05T09:00:00.000Z',
      voidedBy: 'reviewer-1',
    },
    '"v1"',
    { listName: 'Cases-ExampleReview' }
  );

  const patch = voided.calls.find((c) => c.method === 'PATCH');
  assert.ok(patch, 'PATCH was issued');
  assert.deepEqual(JSON.parse(String(patch.body)), {
    Status: 'Void',
    VoidReason: 'duplicate',
    VoidedAt: '2026-07-05T09:00:00.000Z',
    VoidedById: 14,
  });

  const other = makeFetch(respondToWrite());
  await new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: other.fetch,
  }).patchCase('case-1', { notes: 'n' }, '"v1"', {
    listName: 'Cases-ExampleReview',
  });

  const untouched = other.calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(JSON.parse(String(untouched?.body)), { Notes: 'n' });
});
