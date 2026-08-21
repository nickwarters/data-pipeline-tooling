// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
import {
  LIST,
  CASES,
  PERSONAS,
  makeClient,
  completedCase,
  reasonCase,
  makeReasonClient,
  MockSharePointClient,
} from './helpers/mock-sharepoint-client.js';
import {
  ACTION_CENTRE_REASONS,
  activeFilter,
  worstFirstOrder,
} from '../src/services/action-centre-model.js';

// Filter-field behaviour is owned by list-cases-filter-parity.test.js, which
// checks this predicate against hand-written expectations AND a real OData
// evaluator. Only mock-specific affordances belong here: list scoping, the 412
// injection seam, countCases, and the derived-overdue write-through.

test('In-progress Action Centre filter accepts a timestamp and excludes null or omitted allocations from rows and count', async () => {
  const valid = reasonCase('valid-allocation', {
    status: 'In-progress',
    assignedReviewer: 'rev-a',
    assignedAt: '2026-06-01T00:00:00Z',
  });
  const legacy = reasonCase('legacy-null-allocation', {
    status: 'In-progress',
    assignedReviewer: 'rev-a',
    assignedAt: null,
  });
  const omitted = /** @type {Partial<CaseRow>} */ (
    reasonCase('legacy-omitted-allocation', {
      status: 'In-progress',
      assignedReviewer: 'rev-a',
    })
  );
  delete omitted.assignedAt;
  const client = new MockSharePointClient({
    lists: { [LIST]: [/** @type {CaseRow} */ (omitted), legacy, valid] },
    personas: PERSONAS,
  });
  const reason = ACTION_CENTRE_REASONS.find((item) => item.id === 'inProgress');
  assert.ok(reason);
  const filter = activeFilter(reason, 'rev-a');

  assert.equal(await client.countCases(filter, { listName: LIST }), 1);
  assert.deepEqual(
    (
      await client.listCases(filter, {
        listName: LIST,
        ...worstFirstOrder(reason),
      })
    ).map((row) => row.id),
    ['valid-allocation']
  );
});

test('MockSharePointClient: injected 412 returns 412 without writing', async () => {
  const client = makeClient();
  client.inject412();
  const result = await client.patchCase('case-1', { notes: 'x' }, 'etag-1', {
    listName: LIST,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 412);
});

test('MockSharePointClient: listCases scopes strictly to the named list — an unconfigured list returns no rows', async () => {
  const client = makeClient();
  const cases = await client.listCases({}, { listName: 'complaints' });
  assert.equal(
    cases.length,
    0,
    'no default/aggregate store — an unrecognised listName is simply empty'
  );
});

test('MockSharePointClient: listCases scopes to the named list — a Case in one list does not leak into another', async () => {
  const listCase = /** @type {CaseRow} */ ({
    ...CASES[0],
    id: 'psr-1',
    caseType: 'product-sale-review',
    assignedReviewer: 'user-1',
    status: 'In-progress',
  });
  const client = new MockSharePointClient({
    lists: { [LIST]: CASES, complaints: [listCase] },
    personas: PERSONAS,
  });

  const fromDefault = await client.listCases({}, { listName: LIST });
  assert.equal(fromDefault.length, CASES.length);
  assert.ok(!fromDefault.some((c) => c.id === 'psr-1'));

  const fromComplaints = await client.listCases({}, { listName: 'complaints' });
  assert.deepEqual(
    fromComplaints.map((c) => c.id),
    ['psr-1']
  );
});

test('MockSharePointClient: listCases derives the overdue flag, ignoring a contradictory stored value', async () => {
  const client = new MockSharePointClient({
    lists: {
      [LIST]: [
        reasonCase('claims-overdue', {
          status: 'Completed',
          dueDate: '2020-01-01T00:00:00Z',
          overdue: true,
        }),
        reasonCase('claims-on-time', {
          status: 'In-progress',
          dueDate: '2020-01-01T00:00:00Z',
          overdue: false,
        }),
      ],
    },
    personas: PERSONAS,
  });

  const rows = await client.listCases({}, { listName: LIST });
  assert.deepEqual(
    rows.map((c) => [c.id, c.overdue]),
    [
      ['claims-overdue', false],
      ['claims-on-time', true],
    ]
  );
});

test('MockSharePointClient: getCase derives the overdue flag, ignoring a contradictory stored value', async () => {
  const client = new MockSharePointClient({
    lists: {
      [LIST]: [
        reasonCase('claims-overdue', {
          status: 'Completed',
          dueDate: '2020-01-01T00:00:00Z',
          overdue: true,
        }),
      ],
    },
    personas: PERSONAS,
  });

  const row = await client.getCase('claims-overdue', { listName: LIST });
  assert.equal(row?.overdue, false);
});

test('MockSharePointClient: countCases counts a bounded CompletedAt day-slice', async () => {
  const client = new MockSharePointClient({
    lists: {
      [LIST]: [
        completedCase('a', '2026-07-02T08:00:00.000Z'),
        completedCase('b', '2026-07-02T20:00:00.000Z'),
        completedCase('c', '2026-07-03T00:00:00.000Z'),
      ],
    },
    personas: PERSONAS,
  });
  const n = await client.countCases(
    {
      status: 'Completed',
      completedAfter: '2026-07-02T00:00:00.000Z',
      completedBefore: '2026-07-03T00:00:00.000Z',
    },
    { listName: LIST }
  );
  assert.equal(n, 2, 'both 2 Jul completions, not the 3 Jul one');
});

test('MockSharePointClient: countCases returns the count of matching cases', async () => {
  const client = makeReasonClient();
  assert.equal(
    await client.countCases(
      { awaitingResponsibleParty: true },
      { listName: LIST }
    ),
    2
  );
  assert.equal(
    await client.countCases({ hasOpenAppeal: true }, { listName: LIST }),
    1
  );
  assert.equal(await client.countCases({}, { listName: LIST }), 4);
});

test('MockSharePointClient: listCases throws when called without a listName', async () => {
  const client = makeClient();
  await assert.rejects(() => client.listCases({}), /listName is required/);
});

test('MockSharePointClient: countCases throws when called without a listName', async () => {
  const client = makeClient();
  await assert.rejects(() => client.countCases({}), /listName is required/);
});
