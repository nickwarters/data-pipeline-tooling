// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
import {
  LIST,
  CASES,
  QUESTION_DEFS,
  PERSONAS,
  makeClient,
  completedCase,
  reasonCase,
  makeReasonClient,
  MockSharePointClient,
} from './helpers/mock-sharepoint-client.js';

// Capability: case filtering and bounded counts.

test('MockSharePointClient: injected 412 returns 412 without writing', async () => {
  const client = makeClient();
  client.inject412();
  const result = await client.patchCase('case-1', { notes: 'x' }, 'etag-1', {
    listName: LIST,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 412);
});

// --- listCases ---

test('MockSharePointClient: listCases with status filter returns only matching Cases', async () => {
  const client = makeClient();
  const cases = await client.listCases(
    { status: 'In-progress' },
    { listName: LIST }
  );
  assert.equal(cases.length, 2);
  assert.ok(cases.every((c) => c.status === 'In-progress'));
});

test('MockSharePointClient: listCases with Completed filter returns only Completed Cases', async () => {
  const client = makeClient();
  const cases = await client.listCases(
    { status: 'Completed' },
    { listName: LIST }
  );
  assert.equal(cases.length, 1);
  assert.equal(cases[0].id, 'case-3');
});

test('MockSharePointClient: listCases with empty filter returns all Cases in the named list', async () => {
  const client = makeClient();
  const cases = await client.listCases({}, { listName: LIST });
  assert.equal(cases.length, 3);
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
    questionDefinitions: QUESTION_DEFS,
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

test('MockSharePointClient: listCases filters by assignedReviewer', async () => {
  const client = makeClient();
  const cases = await client.listCases(
    { assignedReviewer: 'user-2' },
    { listName: LIST }
  );
  assert.equal(cases.length, 1);
  assert.equal(cases[0].id, 'case-3');
});

test('MockSharePointClient: listCases filters by caseType', async () => {
  const client = makeClient();
  const cases = await client.listCases(
    { caseType: 'example-review' },
    { listName: LIST }
  );
  assert.equal(cases.length, 3);

  // A different caseType should return nothing
  const none = await client.listCases(
    { caseType: 'other-type' },
    { listName: LIST }
  );
  assert.equal(none.length, 0);
});

test('MockSharePointClient: listCases filters by responsibleParty', async () => {
  const client = makeClient();
  const cases = await client.listCases(
    { responsibleParty: 'user-2' },
    { listName: LIST }
  );
  assert.equal(cases.length, 1);
  assert.equal(cases[0].id, 'case-1');
});

test('MockSharePointClient: listCases filters by both caseType and responsibleParty', async () => {
  const client = makeClient();
  const cases = await client.listCases(
    {
      caseType: 'example-review',
      responsibleParty: 'user-3',
    },
    { listName: LIST }
  );
  assert.equal(cases.length, 1);
  assert.equal(cases[0].id, 'case-2');
});

test('MockSharePointClient: listCases filters by effectiveOutcome server-side (ADR-0019)', async () => {
  const client = new MockSharePointClient({
    lists: {
      [LIST]: [
        { ...CASES[2], id: 'r-pass', effectiveOutcome: 'pass' },
        { ...CASES[2], id: 'r-fail', effectiveOutcome: 'fail' },
        { ...CASES[2], id: 'r-fail2', effectiveOutcome: 'fail' },
      ],
    },
    questionDefinitions: QUESTION_DEFS,
    personas: PERSONAS,
    persona: 'reviewer',
  });

  const failures = await client.listCases(
    { effectiveOutcome: 'fail' },
    { listName: LIST }
  );
  assert.deepEqual(
    failures.map((c) => c.id).sort(),
    ['r-fail', 'r-fail2'],
    'only corrected-to-fail Cases'
  );
});

test('MockSharePointClient: listCases filters by outcomeOverridden server-side (ADR-0019)', async () => {
  const client = new MockSharePointClient({
    lists: {
      [LIST]: [
        { ...CASES[2], id: 'clean', outcomeOverridden: false },
        { ...CASES[2], id: 'corrected', outcomeOverridden: true },
      ],
    },
    questionDefinitions: QUESTION_DEFS,
    personas: PERSONAS,
    persona: 'reviewer',
  });

  const corrected = await client.listCases(
    { outcomeOverridden: true },
    { listName: LIST }
  );
  assert.deepEqual(
    corrected.map((c) => c.id),
    ['corrected']
  );
});

// --- listCases overdue filter ---

test('MockSharePointClient: listCases with overdue:true returns only In-progress cases with past dueDate', async () => {
  const PAST = '2020-01-01T00:00:00Z';
  const FUTURE = '2099-01-01T00:00:00Z';
  const overdueCase = /** @type {CaseRow} */ ({
    id: 'od-1',
    caseType: 'example-review',
    title: 'Overdue',
    status: 'In-progress',
    assignedReviewer: '',
    responsibleParty: '',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    dueDate: PAST,
    etag: 'etag-od1',
  });
  const onTimeCase = /** @type {CaseRow} */ ({
    id: 'od-2',
    caseType: 'example-review',
    title: 'On Time',
    status: 'In-progress',
    assignedReviewer: '',
    responsibleParty: '',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    dueDate: FUTURE,
    etag: 'etag-od2',
  });
  const completedLateCase = /** @type {CaseRow} */ ({
    id: 'od-3',
    caseType: 'example-review',
    title: 'Completed Late',
    status: 'Completed',
    assignedReviewer: '',
    responsibleParty: '',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: '2021-01-01T00:00:00Z',
    dueDate: PAST,
    etag: 'etag-od3',
  });
  const noDueDateCase = /** @type {CaseRow} */ ({
    id: 'od-4',
    caseType: 'example-review',
    title: 'No Due Date',
    status: 'In-progress',
    assignedReviewer: '',
    responsibleParty: '',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'etag-od4',
  });

  const client = new MockSharePointClient({
    lists: {
      [LIST]: [overdueCase, onTimeCase, completedLateCase, noDueDateCase],
    },
    questionDefinitions: [],
    personas: PERSONAS,
  });

  const results = await client.listCases({ overdue: true }, { listName: LIST });
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'od-1');
});

test('MockSharePointClient: listCases with overdue:false returns all cases (no overdue filter applied)', async () => {
  const client = makeClient();
  const all = await client.listCases({}, { listName: LIST });
  const sameWithFalse = await client.listCases(
    { overdue: false },
    { listName: LIST }
  );
  assert.equal(sameWithFalse.length, all.length);
});

test('MockSharePointClient: completedAfter is an inclusive CompletedAt lower bound', async () => {
  const client = new MockSharePointClient({
    lists: {
      [LIST]: [
        completedCase('a', '2026-07-01T00:00:00.000Z'),
        completedCase('b', '2026-07-02T00:00:00.000Z'),
        completedCase('c', '2026-07-03T00:00:00.000Z'),
      ],
    },
    questionDefinitions: [],
    personas: PERSONAS,
  });
  const rows = await client.listCases(
    { completedAfter: '2026-07-02T00:00:00.000Z' },
    { listName: LIST }
  );
  assert.deepEqual(
    rows.map((r) => r.id).sort(),
    ['b', 'c'],
    'includes the boundary Case, excludes earlier'
  );
});

test('MockSharePointClient: completedBefore is an exclusive CompletedAt upper bound', async () => {
  const client = new MockSharePointClient({
    lists: {
      [LIST]: [
        completedCase('a', '2026-07-01T00:00:00.000Z'),
        completedCase('b', '2026-07-02T00:00:00.000Z'),
        completedCase('c', '2026-07-03T00:00:00.000Z'),
      ],
    },
    questionDefinitions: [],
    personas: PERSONAS,
  });
  const rows = await client.listCases(
    { completedBefore: '2026-07-02T00:00:00.000Z' },
    { listName: LIST }
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ['a'],
    'excludes the boundary Case so adjacent slices never double-count'
  );
});

test('MockSharePointClient: a never-completed Case is excluded from any CompletedAt window', async () => {
  const client = new MockSharePointClient({
    lists: {
      [LIST]: [
        completedCase('open', null),
        completedCase('done', '2026-07-02T00:00:00.000Z'),
      ],
    },
    questionDefinitions: [],
    personas: PERSONAS,
  });
  const afterOnly = await client.listCases(
    { completedAfter: '2026-07-01T00:00:00.000Z' },
    { listName: LIST }
  );
  assert.deepEqual(
    afterOnly.map((r) => r.id),
    ['done']
  );
  const beforeOnly = await client.listCases(
    { completedBefore: '2026-07-03T00:00:00.000Z' },
    { listName: LIST }
  );
  assert.deepEqual(
    beforeOnly.map((r) => r.id),
    ['done']
  );
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
    questionDefinitions: [],
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

test('MockSharePointClient: listCases filters by assignedReviewerManager', async () => {
  const client = new MockSharePointClient({
    lists: {
      [LIST]: [
        reasonCase('m-1', { assignedReviewerManager: 'mgr-a' }),
        reasonCase('m-2', { assignedReviewerManager: 'mgr-b' }),
      ],
    },
    questionDefinitions: [],
    personas: PERSONAS,
  });
  const rows = await client.listCases(
    { assignedReviewerManager: 'mgr-a' },
    { listName: LIST }
  );
  assert.deepEqual(
    rows.map((c) => c.id),
    ['m-1']
  );
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
  assert.equal(
    await client.countCases({ reopened: true }, { listName: LIST }),
    1
  );
  assert.equal(await client.countCases({}, { listName: LIST }), 5);
});

test('MockSharePointClient: filters by the reviewRequired flag', async () => {
  const client = new MockSharePointClient({
    lists: {
      [LIST]: [
        reasonCase('rr-1', { reviewRequired: true }),
        reasonCase('rr-2', { reviewRequired: true }),
        reasonCase('plain', {}),
      ],
    },
    questionDefinitions: [],
    personas: PERSONAS,
  });
  assert.equal(
    await client.countCases({ reviewRequired: true }, { listName: LIST }),
    2
  );
  const rows = await client.listCases(
    { reviewRequired: false },
    { listName: LIST }
  );
  assert.deepEqual(
    rows.map((c) => c.id),
    ['plain']
  );
});

test('MockSharePointClient: countCases with a listName that has no configured store counts zero', async () => {
  const client = makeReasonClient();
  assert.equal(
    await client.countCases({ reopened: true }, { listName: 'anything' }),
    0
  );
});

test('MockSharePointClient: filters treat a missing reason flag as false', async () => {
  const client = makeReasonClient();
  const notAwaiting = await client.listCases(
    { awaitingResponsibleParty: false },
    { listName: LIST }
  );
  assert.equal(notAwaiting.length, 3);
  assert.ok(!notAwaiting.some((c) => c.id.startsWith('await')));
});

test('MockSharePointClient: listCases throws when called without a listName', async () => {
  const client = makeClient();
  await assert.rejects(() => client.listCases({}), /listName is required/);
});

test('MockSharePointClient: countCases throws when called without a listName', async () => {
  const client = makeClient();
  await assert.rejects(() => client.countCases({}), /listName is required/);
});
