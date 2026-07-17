// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIST,
  PERSONAS,
  makeClient,
  reasonCase,
  makeReasonClient,
  MockSharePointClient,
  reasonFlagFields,
} from './helpers/mock-sharepoint-client.js';

// Capability: paging, ordering, compound reasons, and persisted flags.

test('MockSharePointClient: listCases pages with top and skip', async () => {
  const client = makeReasonClient();
  const first = await client.listCases({}, { listName: LIST, top: 2, skip: 0 });
  assert.equal(first.length, 2);
  const second = await client.listCases(
    {},
    { listName: LIST, top: 2, skip: 2 }
  );
  assert.equal(second.length, 2);
  assert.notDeepEqual(
    first.map((c) => c.id),
    second.map((c) => c.id)
  );
});

test('MockSharePointClient: listCases orders by a column ascending and descending', async () => {
  const client = makeReasonClient();
  const asc = await client.listCases(
    { awaitingResponsibleParty: true },
    { listName: LIST, orderBy: 'awaitingSince', orderDir: 'asc' }
  );
  assert.deepEqual(
    asc.map((c) => c.id),
    ['await-1', 'await-2']
  );
  const desc = await client.listCases(
    { awaitingResponsibleParty: true },
    { listName: LIST, orderBy: 'awaitingSince', orderDir: 'desc' }
  );
  assert.deepEqual(
    desc.map((c) => c.id),
    ['await-2', 'await-1']
  );
});

test('MockSharePointClient: listCases orderBy defaults to ascending', async () => {
  const client = makeReasonClient();
  const rows = await client.listCases(
    { awaitingResponsibleParty: true },
    { listName: LIST, orderBy: 'awaitingSince' }
  );
  assert.deepEqual(
    rows.map((c) => c.id),
    ['await-1', 'await-2']
  );
});

test('MockSharePointClient: orderBy sorts ties stably and treats a missing key as earliest', async () => {
  const client = new MockSharePointClient({
    lists: {
      [LIST]: [
        reasonCase('tie-a', { reopenedAt: '2026-06-01T00:00:00Z' }),
        reasonCase('tie-b', { reopenedAt: '2026-06-01T00:00:00Z' }),
        reasonCase('no-key', {}), // no reopenedAt → sorts first ascending
      ],
    },
    personas: PERSONAS,
  });
  const rows = await client.listCases(
    {},
    { listName: LIST, orderBy: 'reopenedAt' }
  );
  assert.deepEqual(
    rows.map((c) => c.id),
    ['no-key', 'tie-a', 'tie-b']
  );
});

test('MockSharePointClient: orderBy treats two rows that both lack the sort key as equal', async () => {
  const client = new MockSharePointClient({
    lists: {
      [LIST]: [reasonCase('no-key-a', {}), reasonCase('no-key-b', {})],
    },
    personas: PERSONAS,
  });
  const rows = await client.listCases(
    {},
    { listName: LIST, orderBy: 'reopenedAt' }
  );
  assert.deepEqual(
    rows.map((c) => c.id).sort(),
    ['no-key-a', 'no-key-b'],
    "neither row has reopenedAt — comparator falls back to '' on both sides"
  );
});

test('MockSharePointClient: countCases with anyOf ORs sub-filters, deduped across reasons', async () => {
  const client = new MockSharePointClient({
    lists: {
      [LIST]: [
        // Qualifies for two reasons — must be counted once by an OR-count.
        reasonCase('multi', {
          awaitingResponsibleParty: true,
          reopened: true,
        }),
        reasonCase('await-only', { awaitingResponsibleParty: true }),
        reasonCase('none', {}),
      ],
    },
    personas: PERSONAS,
  });

  const orCount = await client.countCases(
    {
      anyOf: [{ awaitingResponsibleParty: true }, { reopened: true }],
    },
    { listName: LIST }
  );
  assert.equal(orCount, 2, 'the two-reason case is counted once');

  const sumOfGroups =
    (await client.countCases(
      { awaitingResponsibleParty: true },
      { listName: LIST }
    )) + (await client.countCases({ reopened: true }, { listName: LIST }));
  assert.equal(sumOfGroups, 3, 'summing groups double-counts the overlap');
});

test('MockSharePointClient: anyOf combines with a base filter (AND of base, OR of anyOf)', async () => {
  const client = makeReasonClient();
  const completedAppealsOrReopened = await client.countCases(
    {
      status: 'Completed',
      anyOf: [{ hasOpenAppeal: true }, { reopened: true }],
    },
    { listName: LIST }
  );
  // Only appeal-1 is Completed; reopened-1 is In-progress and excluded by base.
  assert.equal(completedAppealsOrReopened, 1);
});

// --- Action Centre state flag writes (issue #291) ---

test('MockSharePointClient: a reasonFlagFields write persists and is queryable', async () => {
  const client = makeClient();
  const before = await client.countCases(
    { awaitingResponsibleParty: true },
    { listName: LIST }
  );
  assert.equal(before, 0);

  const fresh = await client.getCase('case-1', { listName: LIST });
  const res = await client.patchCase(
    'case-1',
    reasonFlagFields('awaitingFrontline', true, '2026-07-05T09:00:00Z'),
    /** @type {string} */ (fresh?.etag),
    { listName: LIST }
  );

  assert.equal(res.ok, true);
  assert.equal(res.data?.awaitingResponsibleParty, true);
  assert.equal(res.data?.awaitingSince, '2026-07-05T09:00:00Z');
  assert.equal(
    await client.countCases(
      { awaitingResponsibleParty: true },
      { listName: LIST }
    ),
    1
  );

  // Clearing the flag drops it back out of the reason group.
  const cleared = await client.patchCase(
    'case-1',
    reasonFlagFields('awaitingFrontline', false),
    /** @type {string} */ (res.data?.etag),
    { listName: LIST }
  );
  assert.equal(cleared.data?.awaitingResponsibleParty, false);
  assert.equal(cleared.data?.awaitingSince, null);
  assert.equal(
    await client.countCases(
      { awaitingResponsibleParty: true },
      { listName: LIST }
    ),
    0
  );
});
