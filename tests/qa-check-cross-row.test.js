// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaveQueue } from '../src/services/save-queue.js';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').Override} Override */

/** Flush one round of macrotasks so the debounce timer fires and async settles. */
const tick = () => new Promise((r) => setTimeout(r, 20));

/** The QA Check Case (primary page row) and the original it meta-reviews. */
function fixtures() {
  /** @type {CaseRow} */
  const original = {
    id: 'case-14',
    caseType: 'example-review',
    title: 'Example Review #14',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: { 'q-welcome': { value: 'Yes' } },
    conversation: [],
    notes: '',
    completedAt: '2026-04-05T08:00:00Z',
    outcomeAtCompletion: 'pass',
    etag: 'etag-c14-v1',
  };
  /** @type {CaseRow} */
  const qaCheck = {
    id: 'qa-case-1',
    caseType: 'qa-example-review',
    title: 'QA Check — #14',
    status: 'In-progress',
    assignedReviewer: 'user-qa',
    responsibleParty: '',
    sourceCaseId: 'case-14',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'etag-qa1-v1',
  };
  return { original, qaCheck };
}

/** @returns {Override} */
function override() {
  return {
    source: 'qa',
    sourceCaseId: 'qa-case-1',
    author: 'user-qa',
    at: '2026-06-12T00:00:00Z',
    answerKey: 'q-welcome',
    value: 'No',
    remediationActions: [
      { id: 'ov-1', text: 'Coach on greeting.', completed: false },
    ],
    reasoning: 'No greeting on the recording.',
  };
}

test('QA Check cross-row Override: the write targets the original row, not the QA Check', async () => {
  const { original, qaCheck } = fixtures();
  const client = new MockSharePointClient({
    cases: [qaCheck, original],
    questionDefinitions: [],
    personas: {},
  });
  const saveQueue = new SaveQueue(client, { debounceMs: 0 });
  // The page is on the QA Check, but loads the original's ETag for the cross-row write.
  saveQueue.loadCase(qaCheck);
  saveQueue.loadCase(original);

  // The embedded editor enqueues against the ORIGINAL id while the QA Check is primary.
  saveQueue.enqueue('case-14', 'overrides', [override()]);
  await tick();

  const writtenOriginal = await client.getCase('case-14');
  assert.equal(
    writtenOriginal?.overrides?.length,
    1,
    'the Override landed on the original row'
  );
  assert.equal(
    writtenOriginal?.overrides?.[0].sourceCaseId,
    'qa-case-1',
    'provenance points back to the QA Check'
  );

  const writtenQa = await client.getCase('qa-case-1');
  assert.equal(
    writtenQa?.overrides,
    undefined,
    'the QA Check row is never written'
  );
  assert.equal(
    writtenQa?.sourceCaseId,
    'case-14',
    'the Cases schema round-trips SourceCaseId through the client'
  );
});

test('QA Check cross-row Override: a 412 conflict reloads the original ETag and retries the write', async () => {
  const { original, qaCheck } = fixtures();
  const client = new MockSharePointClient({
    cases: [qaCheck, original],
    questionDefinitions: [],
    personas: {},
  });
  const saveQueue = new SaveQueue(client, { debounceMs: 0 });
  saveQueue.loadCase(original);

  // Force the first PATCH to 412 (stale ETag); the queue must reload the original
  // via getCase and retry. The original's frozen Answers are unchanged, so the
  // reload is a clean fast-forward (not a hard conflict).
  client.inject412();

  saveQueue.enqueue('case-14', 'overrides', [override()]);
  await tick();
  await tick();

  assert.equal(
    saveQueue.status.get(),
    'saved',
    'the retry after the 412 reload succeeds'
  );
  const writtenOriginal = await client.getCase('case-14');
  assert.equal(
    writtenOriginal?.overrides?.length,
    1,
    'the Override is persisted after the reload-retry'
  );
});
