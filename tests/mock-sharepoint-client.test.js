// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';
import { reasonFlagFields } from '../src/services/action-centre-flags.js';

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

// Every Case lives in a named per-Case-Type list store — there is no default
// store (strictness flip). 'Cases-Test' is the standard list name used
// throughout this suite unless a test needs a second, distinctly-named list.
const LIST = 'Cases-Test';

/** @type {CaseRow[]} */
const CASES = [
  {
    id: 'case-1',
    caseType: 'example-review',
    title: 'Example Review #1',
    status: 'In-progress',
    assignedReviewer: 'user-1',
    responsibleParty: 'user-2',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'etag-1',
  },
  {
    id: 'case-2',
    caseType: 'example-review',
    title: 'Example Review #2',
    status: 'In-progress',
    assignedReviewer: 'user-1',
    responsibleParty: 'user-3',
    answers: { 'q-welcome': { value: 'Yes' } },
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'etag-2',
  },
  {
    id: 'case-3',
    caseType: 'example-review',
    title: 'Example Review #3',
    status: 'Completed',
    assignedReviewer: 'user-2',
    responsibleParty: 'user-4',
    answers: { 'q-welcome': { value: 'Yes' }, 'q-needs': { value: 'No' } },
    conversation: [],
    notes: '',
    completedAt: '2026-05-07T00:00:00Z',
    etag: 'etag-3',
  },
];

/** @type {QuestionDefinition[]} */
const QUESTION_DEFS = [
  {
    id: 'q-welcome',
    text: 'Was the customer greeted professionally?',
    responseType: 'yes-no-na',
    deprecated: false,
  },
  {
    id: 'q-needs',
    text: "Were the customer's needs identified?",
    responseType: 'yes-no-na',
    deprecated: false,
  },
  {
    id: 'q-resolve',
    text: 'Was the issue resolved?',
    responseType: 'yes-no-na',
    showWhen: { questionId: 'q-needs', equals: 'Yes' },
    deprecated: false,
  },
];

const PERSONAS = {
  reviewer: { groups: ['Reviewers'] },
  owner: { groups: ['Reviewers', 'CaseTypeOwners'] },
};

/** @param {string} [persona] */
function makeClient(persona = 'reviewer') {
  return new MockSharePointClient({
    lists: { [LIST]: CASES },
    questionDefinitions: QUESTION_DEFS,
    personas: PERSONAS,
    persona,
  });
}

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

test('MockSharePointClient: injected 412 returns 412 without writing', async () => {
  const client = makeClient();
  client.inject412();
  const result = await client.patchCase('case-1', { notes: 'x' }, 'etag-1', {
    listName: LIST,
  });
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

// --- getCurrentUserGroups ---

test('MockSharePointClient: getCurrentUserGroups returns reviewer groups', async () => {
  const client = makeClient('reviewer');
  const groups = await client.getCurrentUserGroups();
  assert.deepEqual(groups, ['Reviewers']);
});

test('MockSharePointClient: getCurrentUserGroups returns owner groups for owner persona', async () => {
  const client = makeClient('owner');
  const groups = await client.getCurrentUserGroups();
  assert.deepEqual(groups, ['Reviewers', 'CaseTypeOwners']);
});

// --- getQuestionDefinitions ---

test('MockSharePointClient: getQuestionDefinitions returns matching definitions', async () => {
  const client = makeClient();
  const defs = await client.getQuestionDefinitions(['q-welcome', 'q-needs']);
  assert.equal(defs.length, 2);
  assert.ok(defs.some((d) => d.id === 'q-welcome'));
  assert.ok(defs.some((d) => d.id === 'q-needs'));
});

test('MockSharePointClient: getQuestionDefinitions returns empty array for unknown ids', async () => {
  const client = makeClient();
  const defs = await client.getQuestionDefinitions(['q-unknown']);
  assert.equal(defs.length, 0);
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

test('MockSharePointClient: getCurrentUserGroups returns empty array for unknown persona', async () => {
  const client = makeClient('unknown-persona'); // not in PERSONAS
  const groups = await client.getCurrentUserGroups();
  assert.deepEqual(
    groups,
    [],
    'unknown persona: personas[p] is undefined → ?. returns undefined → ?? [] returns []'
  );
});

test('MockSharePointClient: getCurrentUser falls back to persona string when persona not in map', async () => {
  const client = makeClient('unknown-persona');
  const user = await client.getCurrentUser();
  assert.equal(
    user.id,
    'unknown-persona',
    'p?.userId ?? persona uses fallback when p is undefined'
  );
  assert.equal(
    user.displayName,
    'unknown-persona',
    'p?.displayName ?? persona uses fallback when p is undefined'
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

// --- listCases / countCases CompletedAt window (ADR-0031 §2) ---

/**
 * @param {string} id
 * @param {string | null} completedAt
 * @returns {CaseRow}
 */
function completedCase(id, completedAt) {
  return /** @type {CaseRow} */ ({
    id,
    caseType: 'example-review',
    title: id,
    status: completedAt ? 'Completed' : 'In-progress',
    assignedReviewer: 'u',
    responsibleParty: 'rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt,
    etag: `etag-${id}`,
  });
}

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

// --- searchPeople ---

/** @type {Array<{ loginName: string, displayName: string, email?: string }>} */
const PEOPLE = [
  {
    loginName: 'jsmith',
    displayName: 'John Smith',
    email: 'jsmith@contoso.com',
  },
  {
    loginName: 'asmith',
    displayName: 'Anna Smith',
    email: 'asmith@contoso.com',
  },
  { loginName: 'bjones', displayName: 'Bola Jones' },
];

/** @param {Array<{ loginName: string, displayName: string, email?: string }>} [people] */
function makePeopleClient(people = PEOPLE) {
  return new MockSharePointClient({
    lists: { [LIST]: CASES },
    questionDefinitions: QUESTION_DEFS,
    personas: PERSONAS,
    people,
  });
}

test('MockSharePointClient: searchPeople matches displayName substring (case-insensitive)', async () => {
  const client = makePeopleClient();
  const results = await client.searchPeople('smith');
  assert.deepEqual(results.map((r) => r.loginName).sort(), [
    'asmith',
    'jsmith',
  ]);
});

test('MockSharePointClient: searchPeople matches loginName substring', async () => {
  const client = makePeopleClient();
  const results = await client.searchPeople('bjon');
  assert.equal(results.length, 1);
  assert.equal(results[0].loginName, 'bjones');
});

test('MockSharePointClient: searchPeople returns full PersonResult shape including email', async () => {
  const client = makePeopleClient();
  const results = await client.searchPeople('john');
  assert.deepEqual(results, [
    {
      loginName: 'jsmith',
      displayName: 'John Smith',
      email: 'jsmith@contoso.com',
    },
  ]);
});

test('MockSharePointClient: searchPeople returns [] for a blank query', async () => {
  const client = makePeopleClient();
  assert.deepEqual(await client.searchPeople('   '), []);
  assert.deepEqual(await client.searchPeople(''), []);
});

test('MockSharePointClient: searchPeople returns [] when nothing matches', async () => {
  const client = makePeopleClient();
  assert.deepEqual(await client.searchPeople('zzz'), []);
});

test('MockSharePointClient: searchPeople defaults to an empty directory when no people provided', async () => {
  const client = makeClient();
  assert.deepEqual(await client.searchPeople('smith'), []);
});

// --- resolveUsers ---

test('MockSharePointClient: resolveUsers maps bare accounts to display names', async () => {
  const client = makePeopleClient();
  const resolved = await client.resolveUsers(['jsmith', 'bjones']);
  assert.deepEqual(resolved, { jsmith: 'John Smith', bjones: 'Bola Jones' });
});

test('MockSharePointClient: resolveUsers returns null for an account not in the directory', async () => {
  const client = makePeopleClient();
  assert.deepEqual(await client.resolveUsers(['nobody']), { nobody: null });
});

test('MockSharePointClient: resolveUsers dedupes repeated accounts', async () => {
  const client = makePeopleClient();
  assert.deepEqual(await client.resolveUsers(['jsmith', 'jsmith']), {
    jsmith: 'John Smith',
  });
});

test('MockSharePointClient: resolveUsers returns an empty map for an empty list', async () => {
  const client = makePeopleClient();
  assert.deepEqual(await client.resolveUsers([]), {});
});

// --- getExportHash (ADR-0021 Step 3) ---

test('MockSharePointClient: getExportHash returns the configured hash for a known slug', async () => {
  const client = new MockSharePointClient({
    lists: { [LIST]: CASES },
    questionDefinitions: QUESTION_DEFS,
    personas: PERSONAS,
    exportHashes: { 'example-review': 'sha256:abc123' },
  });
  const hash = await client.getExportHash('example-review');
  assert.equal(hash, 'sha256:abc123');
});

test('MockSharePointClient: getExportHash returns null when slug has no configured hash', async () => {
  const client = makeClient();
  const hash = await client.getExportHash('example-review');
  assert.equal(hash, null);
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

// --- getVersionedExport (ADR-0021 Step 4) ---

const VERSIONED_EXPORT = {
  slug: 'example-review',
  label: 'Example Review',
  generatedAt: '2026-01-10T09:00:00.000Z',
  hash: 'sha256:' + 'a'.repeat(64),
  questions: [
    {
      id: 'q-v1',
      text: 'V1 question',
      category: null,
      responseType: 'yes-no-na',
      options: null,
      showWhen: null,
      failureCriteria: 'No',
      deprecated: false,
    },
  ],
};

test('MockSharePointClient: getVersionedExport returns the matching export for a known hash (ADR-0021 Step 4)', async () => {
  const client = new MockSharePointClient({
    lists: { [LIST]: CASES },
    questionDefinitions: QUESTION_DEFS,
    personas: PERSONAS,
    versionedExports: { [VERSIONED_EXPORT.hash]: VERSIONED_EXPORT },
  });
  const result = await client.getVersionedExport(
    'example-review',
    VERSIONED_EXPORT.hash
  );
  assert.deepEqual(result, VERSIONED_EXPORT);
});

test('MockSharePointClient: getVersionedExport returns null for an unknown hash (ADR-0021 Step 4)', async () => {
  const client = makeClient();
  const result = await client.getVersionedExport(
    'example-review',
    'sha256:unknown'
  );
  assert.equal(result, null);
});

test('MockSharePointClient: getVersionedExport returns null when no versionedExports configured (ADR-0021 Step 4)', async () => {
  const client = makeClient();
  const result = await client.getVersionedExport(
    'example-review',
    'sha256:' + 'a'.repeat(64)
  );
  assert.equal(result, null);
});

// --- Action Centre: countCases, paging, ordering, reason flags (issue #287) ---

/**
 * @param {string} id
 * @param {Partial<CaseRow>} [over]
 * @returns {CaseRow}
 */
function reasonCase(id, over = {}) {
  return /** @type {CaseRow} */ ({
    id,
    caseType: 'complaints',
    title: id,
    status: 'In-progress',
    assignedReviewer: '',
    responsibleParty: '',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: `etag-${id}`,
    ...over,
  });
}

function makeReasonClient() {
  return new MockSharePointClient({
    lists: {
      [LIST]: [
        reasonCase('await-1', {
          awaitingResponsibleParty: true,
          awaitingSince: '2026-06-01T00:00:00Z',
        }),
        reasonCase('await-2', {
          awaitingResponsibleParty: true,
          awaitingSince: '2026-06-20T00:00:00Z',
        }),
        reasonCase('appeal-1', {
          status: 'Completed',
          hasOpenAppeal: true,
          appealRaisedAt: '2026-06-15T00:00:00Z',
          completedAt: '2026-06-10T00:00:00Z',
        }),
        reasonCase('reopened-1', {
          reopened: true,
          reopenedAt: '2026-06-25T00:00:00Z',
        }),
        reasonCase('plain-1', {}),
      ],
    },
    questionDefinitions: [],
    personas: PERSONAS,
  });
}

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
    questionDefinitions: [],
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
    questionDefinitions: [],
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
    questionDefinitions: [],
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

test('MockSharePointClient: listCases throws when called without a listName', async () => {
  const client = makeClient();
  await assert.rejects(() => client.listCases({}), /listName is required/);
});

test('MockSharePointClient: countCases throws when called without a listName', async () => {
  const client = makeClient();
  await assert.rejects(() => client.countCases({}), /listName is required/);
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
