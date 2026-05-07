// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaveQueue } from '../src/save-queue.js';

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').PatchResult} PatchResult */

/** Flush one round of macrotasks (debounce fires, async chains settle). */
const tick = () => new Promise(r => setTimeout(r, 20));

/** @type {CaseRow} */
const BASE_ROW = {
  id: 'c1',
  caseType: 'test',
  title: 'Test Case',
  status: 'In-progress',
  assignedReviewer: 'u1',
  responsibleParty: 'u2',
  answers: {},
  conversation: [],
  notes: '',
  completedAt: null,
  etag: 'etag-1',
};

/**
 * Minimal stub client. patchResponses are consumed in order; when exhausted
 * a default success (new etag) is returned. getCaseRow is what getCase returns.
 * @param {{ patchResponses?: PatchResult[], getCaseRow?: CaseRow }} [opts]
 */
function makeClient({ patchResponses = [], getCaseRow } = {}) {
  let idx = 0;
  /** @type {{ fields: Partial<CaseRow>, etag: string }[]} */
  const patchCalls = [];
  let liveRow = { ...BASE_ROW };

  return {
    patchCalls,
    /** Override the live row (simulates external mutation on the server). */
    setLiveRow(/** @type {CaseRow} */ row) { liveRow = { ...row }; },
    /**
     * @param {string} _id
     * @param {Partial<CaseRow>} fields
     * @param {string} etag
     * @returns {Promise<PatchResult>}
     */
    async patchCase(_id, fields, etag) {
      patchCalls.push({ fields, etag });
      if (idx < patchResponses.length) return patchResponses[idx++];
      const newEtag = `etag-ok-${patchCalls.length}`;
      liveRow = { ...liveRow, ...fields, etag: newEtag };
      return { ok: true, status: 200, data: { ...liveRow } };
    },
    async getCase(/** @type {string} */ _id) {
      return getCaseRow !== undefined ? getCaseRow : { ...liveRow };
    },
    async getQuestionDefinitions() { return []; },
    async listCases() { return []; },
    async getCurrentUserGroups() { return []; },
  };
}

// --- status ---

test('SaveQueue: initial status is saved', () => {
  const q = new SaveQueue(makeClient());
  assert.equal(q.status.get(), 'saved');
});

test('SaveQueue: status becomes saving immediately after enqueue', () => {
  const q = new SaveQueue(makeClient(), { debounceMs: 0 });
  q.loadCase(BASE_ROW);
  q.enqueue('c1', 'notes', 'hello');
  assert.equal(q.status.get(), 'saving');
});

// --- debounce ---

test('SaveQueue: rapid calls to same field result in exactly one PATCH', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(BASE_ROW);

  q.enqueue('c1', 'notes', 'a');
  q.enqueue('c1', 'notes', 'b');
  q.enqueue('c1', 'notes', 'c');

  await tick();

  assert.equal(client.patchCalls.length, 1);
  assert.deepEqual(client.patchCalls[0].fields, { notes: 'c' });
});

test('SaveQueue: different fields each get their own debounced PATCH', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(BASE_ROW);

  q.enqueue('c1', 'notes', 'my note');
  q.enqueue('c1', 'status', 'In-progress');

  await tick();

  assert.equal(client.patchCalls.length, 2);
});

// --- ETag ---

test('SaveQueue: PATCH is sent with the stored ETag', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(BASE_ROW); // etag = 'etag-1'

  q.enqueue('c1', 'notes', 'x');
  await tick();

  assert.equal(client.patchCalls[0].etag, 'etag-1');
});

test('SaveQueue: on success the stored ETag is updated for subsequent PATCHes', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(BASE_ROW);

  q.enqueue('c1', 'notes', 'first');
  await tick();
  const etag1 = client.patchCalls[0].etag;

  q.enqueue('c1', 'notes', 'second');
  await tick();
  const etag2 = client.patchCalls[1].etag;

  assert.notEqual(etag1, etag2);
});

// --- success status ---

test('SaveQueue: status is saved after successful PATCH', async () => {
  const q = new SaveQueue(makeClient(), { debounceMs: 0 });
  q.loadCase(BASE_ROW);

  q.enqueue('c1', 'notes', 'hello');
  await tick();

  assert.equal(q.status.get(), 'saved');
});

// --- network retry ---

test('SaveQueue: on non-412 error status becomes reconnecting', async () => {
  const client = makeClient({
    patchResponses: [{ ok: false, status: 503 }],
  });
  // backoffSchedule longer than tick(20ms) so retry hasn't fired yet when we assert
  const q = new SaveQueue(client, { debounceMs: 0, backoffSchedule: [200] });
  q.loadCase(BASE_ROW);

  q.enqueue('c1', 'notes', 'hello');
  await tick();

  assert.equal(q.status.get(), 'reconnecting');
});

test('SaveQueue: retries after network failure and eventually saves', async () => {
  const client = makeClient({
    patchResponses: [{ ok: false, status: 503 }, { ok: false, status: 503 }],
  });
  const q = new SaveQueue(client, { debounceMs: 0, backoffSchedule: [0] });
  q.loadCase(BASE_ROW);

  q.enqueue('c1', 'notes', 'hello');
  // tick × 3: debounce → fail → retry → fail → retry → success
  await tick(); await tick(); await tick();

  assert.equal(q.status.get(), 'saved');
  assert.equal(client.patchCalls.length, 3);
});

// --- 412 non-conflicting ---

test('SaveQueue: 412 with unchanged remote answers silently retries', async () => {
  // inject412 path: mock returns 412 but answers on server stay the same
  const client = makeClient({
    patchResponses: [{ ok: false, status: 412 }],
  });
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(BASE_ROW); // baselineAnswers = {}

  q.enqueue('c1', 'notes', 'hello');
  await tick();

  assert.equal(q.status.get(), 'saved');
  assert.equal(client.patchCalls.length, 2);
});

test('SaveQueue: 412 non-conflicting: retry uses refreshed ETag', async () => {
  // Server has etag-2 but same answers after the 412
  const freshRow = { ...BASE_ROW, etag: 'etag-2', answers: {} };
  const client = makeClient({
    patchResponses: [{ ok: false, status: 412 }],
    getCaseRow: freshRow,
  });
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(BASE_ROW);

  q.enqueue('c1', 'notes', 'hello');
  await tick();

  assert.equal(client.patchCalls.length, 2);
  assert.equal(client.patchCalls[1].etag, 'etag-2');
});

// --- 412 conflict ---

test('SaveQueue: 412 with changed remote answers sets status to conflict', async () => {
  // Server now has different answers than our baseline
  const freshRow = {
    ...BASE_ROW,
    etag: 'etag-2',
    answers: { 'q-1': { value: 'Yes' } },
  };
  const client = makeClient({
    patchResponses: [{ ok: false, status: 412 }],
    getCaseRow: freshRow,
  });
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(BASE_ROW); // baselineAnswers = {}

  q.enqueue('c1', 'notes', 'hello');
  await tick();

  assert.equal(q.status.get(), 'conflict');
});

test('SaveQueue: conflict does not trigger a retry PATCH', async () => {
  const freshRow = {
    ...BASE_ROW,
    etag: 'etag-2',
    answers: { 'q-1': { value: 'Yes' } },
  };
  const client = makeClient({
    patchResponses: [{ ok: false, status: 412 }],
    getCaseRow: freshRow,
  });
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(BASE_ROW);

  q.enqueue('c1', 'notes', 'hello');
  await tick();

  assert.equal(client.patchCalls.length, 1);
});
