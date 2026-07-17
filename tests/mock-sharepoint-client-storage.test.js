// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIST,
  CASES,
  QUESTION_DEFS,
  PERSONAS,
  makeClient,
  MockSharePointClient,
} from './helpers/mock-sharepoint-client.js';

// Capability: named-list reads, writes, concurrency, and snapshots.

// --- getCase ---

test('MockSharePointClient: getCase returns the correct fixture Case', async () => {
  const client = makeClient();
  const c = await client.getCase('case-1', { listName: LIST });
  assert.equal(c?.id, 'case-1');
  assert.equal(c?.title, 'Example Review #1');
  assert.equal(c?.status, 'In-progress');
});

test('MockSharePointClient: getCase returns null for an unknown id', async () => {
  const client = makeClient();
  const c = await client.getCase('case-999', { listName: LIST });
  assert.equal(c, null);
});

test('MockSharePointClient: getCase round-trips the details JSON blob (issue #213)', async () => {
  const client = new MockSharePointClient({
    lists: {
      [LIST]: [
        {
          id: 'case-d',
          caseType: 'example-review',
          title: 'With details',
          status: 'In-progress',
          assignedReviewer: 'user-1',
          responsibleParty: 'user-2',
          answers: {},
          conversation: [],
          details: { customerName: 'Jordan Lee', accountNumber: 'ACC-4471' },
          notes: '',
          completedAt: null,
          etag: 'etag-d',
        },
      ],
    },
    questionDefinitions: QUESTION_DEFS,
    personas: PERSONAS,
  });
  const c = await client.getCase('case-d', { listName: LIST });
  assert.deepEqual(c?.details, {
    customerName: 'Jordan Lee',
    accountNumber: 'ACC-4471',
  });
});

test('MockSharePointClient: patchCase round-trips an updated details blob (issue #213)', async () => {
  const client = makeClient();
  const details = { customerName: 'Sam Rivera' };
  const result = await client.patchCase('case-1', { details }, 'etag-1', {
    listName: LIST,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data?.details, details);
  const reread = await client.getCase('case-1', { listName: LIST });
  assert.deepEqual(reread?.details, details);
});

// --- patchCase ---

test('MockSharePointClient: patchCase merges only the specified fields', async () => {
  const client = makeClient();
  const result = await client.patchCase(
    'case-1',
    { notes: 'test note' },
    'etag-1',
    { listName: LIST }
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.data?.notes, 'test note');
  // Fields not in the patch remain unchanged
  assert.equal(result.data?.title, 'Example Review #1');
  assert.equal(result.data?.status, 'In-progress');
  assert.equal(result.data?.assignedReviewer, 'user-1');
});

test('MockSharePointClient: patchCase ETag changes after each write', async () => {
  const client = makeClient();
  const r1 = await client.patchCase('case-1', { notes: 'first' }, 'etag-1', {
    listName: LIST,
  });
  assert.equal(r1.ok, true);
  const newEtag = r1.data?.etag ?? '';
  assert.notEqual(newEtag, 'etag-1');

  const r2 = await client.patchCase('case-1', { notes: 'second' }, newEtag, {
    listName: LIST,
  });
  assert.equal(r2.ok, true);
  assert.notEqual(r2.data?.etag, newEtag);
});

test('MockSharePointClient: patchCase against an unknown id returns 404', async () => {
  const client = makeClient();
  const result = await client.patchCase(
    'case-does-not-exist',
    { notes: 'x' },
    'etag-1',
    { listName: LIST }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test('MockSharePointClient: patchCase with a stale ETag returns 412', async () => {
  const client = makeClient();
  const result = await client.patchCase(
    'case-1',
    { notes: 'x' },
    'wrong-etag',
    { listName: LIST }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 412);
});

test('MockSharePointClient: patchCase succeeds normally after the injected 412 fires', async () => {
  const client = makeClient();
  client.inject412();
  await client.patchCase('case-1', { notes: 'x' }, 'etag-1', {
    listName: LIST,
  }); // 412, no write
  // Original etag is still valid because the 412 did not write
  const result = await client.patchCase('case-1', { notes: 'y' }, 'etag-1', {
    listName: LIST,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data?.notes, 'y');
});

test('MockSharePointClient: patchCase with questionBankVersion round-trips the field (ADR-0021 Step 3)', async () => {
  const client = makeClient();
  const result = await client.patchCase(
    'case-1',
    { questionBankVersion: 'sha256:deadbeef' },
    'etag-1',
    { listName: LIST }
  );
  assert.equal(result.ok, true);
  assert.equal(result.data?.questionBankVersion, 'sha256:deadbeef');
  const stored = await client.getCase('case-1', { listName: LIST });
  assert.equal(stored?.questionBankVersion, 'sha256:deadbeef');
});

test('MockSharePointClient: getCase and patchCase can target a supplied listName', async () => {
  const complaints = {
    ...CASES[0],
    id: 'case-1',
    caseType: 'product-sale-review',
    title: 'Complaint Case',
    etag: 'complaints-etag-1',
  };
  const client = new MockSharePointClient({
    lists: { [LIST]: CASES, complaints: [complaints] },
    questionDefinitions: QUESTION_DEFS,
    personas: PERSONAS,
  });

  assert.equal(
    (await client.getCase('case-1', { listName: LIST }))?.title,
    'Example Review #1'
  );
  assert.equal(
    (await client.getCase('case-1', { listName: 'complaints' }))?.title,
    'Complaint Case'
  );

  const result = await client.patchCase(
    'case-1',
    { notes: 'complaint note' },
    'complaints-etag-1',
    { listName: 'complaints' }
  );
  assert.equal(result.ok, true);
  assert.equal(
    (await client.getCase('case-1', { listName: 'complaints' }))?.notes,
    'complaint note'
  );
  assert.equal((await client.getCase('case-1', { listName: LIST }))?.notes, '');
});

// --- strictness: listName is mandatory (no default Case store) ---

test('MockSharePointClient: getCase throws when called without a listName', async () => {
  const client = makeClient();
  await assert.rejects(() => client.getCase('case-1'), /listName is required/);
});

test('MockSharePointClient: patchCase throws when called without a listName', async () => {
  const client = makeClient();
  await assert.rejects(
    () => client.patchCase('case-1', { notes: 'x' }, 'etag-1'),
    /listName is required/
  );
});

// --- snapshot() ---

test('MockSharePointClient: snapshot() returns a deep-cloned lists-only view of the case stores', async () => {
  const client = makeClient();
  await client.patchCase('case-1', { notes: 'snapshot me' }, 'etag-1', {
    listName: LIST,
  });

  const snap = client.snapshot();
  assert.deepEqual(Object.keys(snap), ['lists']);
  assert.equal(
    snap.lists[LIST].find((c) => c.id === 'case-1')?.notes,
    'snapshot me'
  );

  // Deep-cloned: mutating the snapshot must not affect the live store.
  snap.lists[LIST][0].notes = 'mutated';
  const reread = await client.getCase('case-1', { listName: LIST });
  assert.notEqual(reread?.notes, 'mutated');
});
