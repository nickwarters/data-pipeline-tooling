// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/** @type {CaseRow[]} */
const CASES = [
  {
    id: 'case-1',
    caseType: 'hello-review',
    title: 'Hello Review #1',
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
    caseType: 'hello-review',
    title: 'Hello Review #2',
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
    caseType: 'hello-review',
    title: 'Hello Review #3',
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
  { id: 'q-welcome', text: 'Was the customer greeted professionally?', responseType: 'yes-no-na', deprecated: false },
  { id: 'q-needs', text: "Were the customer's needs identified?", responseType: 'yes-no-na', deprecated: false },
  { id: 'q-resolve', text: 'Was the issue resolved?', responseType: 'yes-no-na', showWhen: { questionId: 'q-needs', equals: 'Yes' }, deprecated: false },
];

const PERSONAS = {
  reviewer: { groups: ['Reviewers'] },
  owner: { groups: ['Reviewers', 'CaseTypeOwners'] },
};

/** @param {string} [persona] */
function makeClient(persona = 'reviewer') {
  return new MockSharePointClient({
    cases: CASES,
    questionDefinitions: QUESTION_DEFS,
    personas: PERSONAS,
    persona,
  });
}

// --- getCase ---

test('MockSharePointClient: getCase returns the correct fixture Case', async () => {
  const client = makeClient();
  const c = await client.getCase('case-1');
  assert.equal(c?.id, 'case-1');
  assert.equal(c?.title, 'Hello Review #1');
  assert.equal(c?.status, 'In-progress');
});

test('MockSharePointClient: getCase returns null for an unknown id', async () => {
  const client = makeClient();
  const c = await client.getCase('case-999');
  assert.equal(c, null);
});

// --- patchCase ---

test('MockSharePointClient: patchCase merges only the specified fields', async () => {
  const client = makeClient();
  const result = await client.patchCase('case-1', { notes: 'test note' }, 'etag-1');
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.data?.notes, 'test note');
  // Fields not in the patch remain unchanged
  assert.equal(result.data?.title, 'Hello Review #1');
  assert.equal(result.data?.status, 'In-progress');
  assert.equal(result.data?.assignedReviewer, 'user-1');
});

test('MockSharePointClient: patchCase ETag changes after each write', async () => {
  const client = makeClient();
  const r1 = await client.patchCase('case-1', { notes: 'first' }, 'etag-1');
  assert.equal(r1.ok, true);
  const newEtag = r1.data?.etag ?? '';
  assert.notEqual(newEtag, 'etag-1');

  const r2 = await client.patchCase('case-1', { notes: 'second' }, newEtag);
  assert.equal(r2.ok, true);
  assert.notEqual(r2.data?.etag, newEtag);
});

test('MockSharePointClient: patchCase with a stale ETag returns 412', async () => {
  const client = makeClient();
  const result = await client.patchCase('case-1', { notes: 'x' }, 'wrong-etag');
  assert.equal(result.ok, false);
  assert.equal(result.status, 412);
});

test('MockSharePointClient: injected 412 returns 412 without writing', async () => {
  const client = makeClient();
  client.inject412();
  const result = await client.patchCase('case-1', { notes: 'x' }, 'etag-1');
  assert.equal(result.ok, false);
  assert.equal(result.status, 412);
});

test('MockSharePointClient: patchCase succeeds normally after the injected 412 fires', async () => {
  const client = makeClient();
  client.inject412();
  await client.patchCase('case-1', { notes: 'x' }, 'etag-1'); // 412, no write
  // Original etag is still valid because the 412 did not write
  const result = await client.patchCase('case-1', { notes: 'y' }, 'etag-1');
  assert.equal(result.ok, true);
  assert.equal(result.data?.notes, 'y');
});

// --- listCases ---

test('MockSharePointClient: listCases with status filter returns only matching Cases', async () => {
  const client = makeClient();
  const cases = await client.listCases({ status: 'In-progress' });
  assert.equal(cases.length, 2);
  assert.ok(cases.every(c => c.status === 'In-progress'));
});

test('MockSharePointClient: listCases with Completed filter returns only Completed Cases', async () => {
  const client = makeClient();
  const cases = await client.listCases({ status: 'Completed' });
  assert.equal(cases.length, 1);
  assert.equal(cases[0].id, 'case-3');
});

test('MockSharePointClient: listCases with empty filter returns all Cases', async () => {
  const client = makeClient();
  const cases = await client.listCases({});
  assert.equal(cases.length, 3);
});

test('MockSharePointClient: listCases filters by assignedReviewer', async () => {
  const client = makeClient();
  const cases = await client.listCases({ assignedReviewer: 'user-2' });
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
  assert.ok(defs.some(d => d.id === 'q-welcome'));
  assert.ok(defs.some(d => d.id === 'q-needs'));
});

test('MockSharePointClient: getQuestionDefinitions returns empty array for unknown ids', async () => {
  const client = makeClient();
  const defs = await client.getQuestionDefinitions(['q-unknown']);
  assert.equal(defs.length, 0);
});

test('MockSharePointClient: listCases filters by caseType', async () => {
  const client = makeClient();
  const cases = await client.listCases({ caseType: 'hello-review' });
  assert.equal(cases.length, 3);

  // A different caseType should return nothing
  const none = await client.listCases({ caseType: 'other-type' });
  assert.equal(none.length, 0);
});

test('MockSharePointClient: listCases filters by responsibleParty', async () => {
  const client = makeClient();
  const cases = await client.listCases({ responsibleParty: 'user-2' });
  assert.equal(cases.length, 1);
  assert.equal(cases[0].id, 'case-1');
});

test('MockSharePointClient: listCases filters by both caseType and responsibleParty', async () => {
  const client = makeClient();
  const cases = await client.listCases({ caseType: 'hello-review', responsibleParty: 'user-3' });
  assert.equal(cases.length, 1);
  assert.equal(cases[0].id, 'case-2');
});

test('MockSharePointClient: getCurrentUserGroups returns empty array for unknown persona', async () => {
  const client = makeClient('unknown-persona'); // not in PERSONAS
  const groups = await client.getCurrentUserGroups();
  assert.deepEqual(groups, [], 'unknown persona: personas[p] is undefined → ?. returns undefined → ?? [] returns []');
});

test('MockSharePointClient: getCurrentUser falls back to persona string when persona not in map', async () => {
  const client = makeClient('unknown-persona');
  const user = await client.getCurrentUser();
  assert.equal(user.id, 'unknown-persona', 'p?.userId ?? persona uses fallback when p is undefined');
  assert.equal(user.displayName, 'unknown-persona', 'p?.displayName ?? persona uses fallback when p is undefined');
});

// --- listCases overdue filter ---

test('MockSharePointClient: listCases with overdue:true returns only In-progress cases with past dueDate', async () => {
  const PAST = '2020-01-01T00:00:00Z';
  const FUTURE = '2099-01-01T00:00:00Z';
  const overdueCase = /** @type {CaseRow} */ ({
    id: 'od-1', caseType: 'hello-review', title: 'Overdue', status: 'In-progress',
    assignedReviewer: '', responsibleParty: '', answers: {}, conversation: [], notes: '',
    completedAt: null, dueDate: PAST, etag: 'etag-od1',
  });
  const onTimeCase = /** @type {CaseRow} */ ({
    id: 'od-2', caseType: 'hello-review', title: 'On Time', status: 'In-progress',
    assignedReviewer: '', responsibleParty: '', answers: {}, conversation: [], notes: '',
    completedAt: null, dueDate: FUTURE, etag: 'etag-od2',
  });
  const completedLateCase = /** @type {CaseRow} */ ({
    id: 'od-3', caseType: 'hello-review', title: 'Completed Late', status: 'Completed',
    assignedReviewer: '', responsibleParty: '', answers: {}, conversation: [], notes: '',
    completedAt: '2021-01-01T00:00:00Z', dueDate: PAST, etag: 'etag-od3',
  });
  const noDueDateCase = /** @type {CaseRow} */ ({
    id: 'od-4', caseType: 'hello-review', title: 'No Due Date', status: 'In-progress',
    assignedReviewer: '', responsibleParty: '', answers: {}, conversation: [], notes: '',
    completedAt: null, etag: 'etag-od4',
  });

  const client = new MockSharePointClient({
    cases: [overdueCase, onTimeCase, completedLateCase, noDueDateCase],
    questionDefinitions: [],
    personas: PERSONAS,
  });

  const results = await client.listCases({ overdue: true });
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'od-1');
});

test('MockSharePointClient: listCases with overdue:false returns all cases (no overdue filter applied)', async () => {
  const client = makeClient();
  const all = await client.listCases({});
  const sameWithFalse = await client.listCases({ overdue: false });
  assert.equal(sameWithFalse.length, all.length);
});
