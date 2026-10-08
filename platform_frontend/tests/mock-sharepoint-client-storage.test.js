// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIST,
  CASES,
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

test('MockSharePointClient: getCase round-trips the details JSON blob', async () => {
  const client = new MockSharePointClient({
    lists: {
      [LIST]: [
        {
          id: 'case-d',
          caseType: 'example-review',
          title: 'With details',
          status: 'In-progress',
          assignedReviewer: 'user-1',
          assignedAt: '2026-05-01T09:00:00Z',
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
    personas: PERSONAS,
  });
  const c = await client.getCase('case-d', { listName: LIST });
  assert.deepEqual(c?.details, {
    customerName: 'Jordan Lee',
    accountNumber: 'ACC-4471',
  });
});

test('MockSharePointClient: patchCase round-trips an updated details blob', async () => {
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

test('MockSharePointClient: a written Responsible Party comes back named, as a real read would', async () => {
  // The real client gets the display name by expanding the person column on the
  // next read. The mock has a directory of its own, so it resolves the same
  // name from it rather than leaving the previous person's name on the row.
  const client = new MockSharePointClient({
    lists: {
      [LIST]: [
        {
          id: 'case-rp',
          caseType: 'example-review',
          title: 'RP',
          status: 'In-progress',
          assignedReviewer: 'user-1',
          assignedAt: '2026-05-01T09:00:00Z',
          responsibleParty: 'bjones',
          responsiblePartyDisplayName: 'Bola Jones',
          answers: {},
          conversation: [],
          notes: '',
          completedAt: null,
          etag: 'etag-rp',
        },
      ],
    },
    personas: PERSONAS,
    people: [{ loginName: 'jsmith', displayName: 'John Smith' }],
  });

  const result = await client.patchCase(
    'case-rp',
    { responsibleParty: 'jsmith' },
    'etag-rp',
    { listName: LIST }
  );

  assert.equal(result.data?.responsibleParty, 'jsmith');
  assert.equal(result.data?.responsiblePartyDisplayName, 'John Smith');

  const cleared = await client.patchCase(
    'case-rp',
    { responsibleParty: '' },
    String(result.data?.etag),
    { listName: LIST }
  );
  assert.equal(
    cleared.data?.responsiblePartyDisplayName,
    undefined,
    'nobody responsible is nobody to name'
  );
});

test('MockSharePointClient: On hold fields round-trip together under mock mode', async () => {
  const client = makeClient();
  const result = await client.patchCase(
    'case-1',
    {
      onHold: true,
      placedOnHoldAt: '2026-07-23T09:30:00.000Z',
    },
    'etag-1',
    { listName: LIST }
  );

  assert.equal(result.ok, true);
  const reread = await client.getCase('case-1', { listName: LIST });
  assert.equal(reread?.onHold, true);
  assert.equal(reread?.placedOnHoldAt, '2026-07-23T09:30:00.000Z');
});

test('MockSharePointClient: non-held filters treat absent and false On hold values as active', async () => {
  const client = new MockSharePointClient({
    lists: {
      [LIST]: [
        { ...CASES[0], id: 'absent', onHold: undefined },
        { ...CASES[0], id: 'active', onHold: false },
        { ...CASES[0], id: 'held', onHold: true },
      ],
    },
    personas: PERSONAS,
  });

  const rows = await client.listCases(
    { status: 'In-progress', assignedReviewer: 'user-1', onHold: false },
    { listName: LIST }
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    ['absent', 'active']
  );
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
  assert.deepEqual(result.failure, { reason: 'not-found' });
});

test('MockSharePointClient: an injected failure is returned once, writes nothing, and carries its failure', async () => {
  const client = makeClient();
  const before = await client.getCase('case-1', { listName: LIST });
  client.injectPatchFailure({
    ok: false,
    status: 500,
    failure: { reason: 'person-not-found', account: 'jsmith' },
  });

  const failed = await client.patchCase(
    'case-1',
    { notes: 'x' },
    String(before?.etag),
    { listName: LIST }
  );
  const after = await client.getCase('case-1', { listName: LIST });
  const retried = await client.patchCase(
    'case-1',
    { notes: 'x' },
    String(before?.etag),
    { listName: LIST }
  );

  assert.deepEqual(failed, {
    ok: false,
    status: 500,
    failure: { reason: 'person-not-found', account: 'jsmith' },
  });
  assert.equal(after?.notes, before?.notes, 'a failed save writes nothing');
  assert.equal(retried.ok, true, 'only the next save fails');
});

test('MockSharePointClient: an injected failure with no reason is classified from its status', async () => {
  const client = makeClient();
  const expected = /** @type {const} */ ({
    0: 'network',
    400: 'invalid-value',
    403: 'forbidden',
    503: 'unavailable',
    500: 'unknown',
  });
  for (const [status, reason] of Object.entries(expected)) {
    client.injectPatchFailure({ ok: false, status: Number(status) });

    const result = await client.patchCase('case-1', { notes: 'x' }, 'e', {
      listName: LIST,
    });

    assert.equal(result.status, Number(status));
    assert.equal(result.failure?.reason, reason, status);
  }
});

test('MockSharePointClient: pasted control characters are cleaned from saved text as the real client cleans them', async () => {
  const client = makeClient();
  const before = await client.getCase('case-1', { listName: LIST });

  await client.patchCase(
    'case-1',
    { notes: 'line one\u000Bline two\u0007 \u{1F600}' },
    String(before?.etag),
    { listName: LIST }
  );
  const after = await client.getCase('case-1', { listName: LIST });

  assert.equal(after?.notes, 'line one\nline two \u{1F600}');
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

test('MockSharePointClient: patchCase with questionBankVersion round-trips the field', async () => {
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
