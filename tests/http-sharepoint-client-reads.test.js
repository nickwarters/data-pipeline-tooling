// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import {
  WEB_URL,
  makeFetch,
  overdueFor,
} from './helpers/http-sharepoint-client.js';

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

  // parseJsonField catch block returns fallback for invalid JSON (lines 349-350)
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

  const row = await client.getCase('case-1', {
    listName: 'Cases-ExampleReview',
  });

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

test('HttpSharePointClient: overdue is true for an In-progress case past its DueDate', async () => {
  assert.equal(
    await overdueFor({
      Status: 'In-progress',
      DueDate: '2020-01-01T00:00:00.000Z',
    }),
    true
  );
});

test('HttpSharePointClient: overdue is false for an In-progress case with a future DueDate', async () => {
  assert.equal(
    await overdueFor({
      Status: 'In-progress',
      DueDate: '2999-01-01T00:00:00.000Z',
    }),
    false
  );
});

test('HttpSharePointClient: overdue is false for an In-progress case with no DueDate', async () => {
  assert.equal(await overdueFor({ Status: 'In-progress' }), false);
});

test('HttpSharePointClient: overdue is false for a non-In-progress case even when past due', async () => {
  assert.equal(
    await overdueFor({
      Status: 'Completed',
      DueDate: '2020-01-01T00:00:00.000Z',
    }),
    false
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
  const row = await client.getCase('case-x', {
    listName: 'Cases-ExampleReview',
  });
  assert.equal(row?.assignedReviewerManager, 'mgr-r');
  assert.equal(row?.responsiblePartyManager, 'mgr-rp');
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
