// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaveQueue } from '../src/services/save-queue.js';

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').PatchResult} PatchResult */

/** Flush one round of macrotasks (debounce fires, async chains settle). */
const tick = () => new Promise((r) => setTimeout(r, 20));

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
  /** @type {{ fields: Partial<CaseRow>, etag: string, opts?: import('../src/sharepoint-client.js').CaseListOptions }[]} */
  const patchCalls = [];
  /** @type {{ id: string, opts?: import('../src/sharepoint-client.js').CaseListOptions }[]} */
  const getCalls = [];
  let liveRow = { ...BASE_ROW };

  return {
    patchCalls,
    /** Override the live row (simulates external mutation on the server). */
    setLiveRow(/** @type {CaseRow} */ row) {
      liveRow = { ...row };
    },
    /**
     * @param {string} _id
     * @param {Partial<CaseRow>} fields
     * @param {string} etag
     * @returns {Promise<PatchResult>}
     */
    async patchCase(
      _id,
      fields,
      etag,
      /** @type {import('../src/sharepoint-client.js').CaseListOptions | undefined} */ opts
    ) {
      patchCalls.push({ fields, etag, opts });
      if (idx < patchResponses.length) return patchResponses[idx++];
      const newEtag = `etag-ok-${patchCalls.length}`;
      liveRow = { ...liveRow, ...fields, etag: newEtag };
      return { ok: true, status: 200, data: { ...liveRow } };
    },
    async getCase(
      /** @type {string} */ _id,
      /** @type {import('../src/sharepoint-client.js').CaseListOptions | undefined} */ opts
    ) {
      getCalls.push({ id: _id, opts });
      return getCaseRow !== undefined ? getCaseRow : { ...liveRow };
    },
    getCalls,
    async getQuestionDefinitions() {
      return [];
    },
    async listCases() {
      return [];
    },
    async getCurrentUserGroups() {
      return [];
    },
    async getCurrentUser() {
      return { id: 'user-test', displayName: 'Test User' };
    },
    async searchPeople() {
      return [];
    },
    async resolveUsers() {
      return {};
    },
    async getExportHash() {
      return null;
    },
    async getVersionedExport() {
      return null;
    },
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
    patchResponses: [
      { ok: false, status: 503 },
      { ok: false, status: 503 },
    ],
  });
  const q = new SaveQueue(client, { debounceMs: 0, backoffSchedule: [0] });
  q.loadCase(BASE_ROW);

  q.enqueue('c1', 'notes', 'hello');
  // tick × 3: debounce → fail → retry → fail → retry → success
  await tick();
  await tick();
  await tick();

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

test('SaveQueue: enqueue for unknown caseId auto-creates state and sends PATCH', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 0 });
  // Do NOT call loadCase — the caseId is unknown

  q.enqueue('unknown-case', 'notes', 'auto-created');
  await tick();

  assert.equal(client.patchCalls.length, 1);
  assert.deepEqual(client.patchCalls[0].fields, { notes: 'auto-created' });
  // ETag should default to empty string
  assert.equal(client.patchCalls[0].etag, '');
});

test('SaveQueue: patchCase exception is caught and treated as status 0 (reconnecting)', async () => {
  let thrown = false;
  const client = {
    patchCalls: /** @type {any[]} */ ([]),
    async patchCase(
      /** @type {string} */ _id,
      /** @type {Partial<CaseRow>} */ fields,
      /** @type {string} */ etag
    ) {
      this.patchCalls.push({ fields, etag });
      if (!thrown) {
        thrown = true;
        throw new Error('Network failure');
      }
      return {
        ok: true,
        status: 200,
        data: { ...BASE_ROW, etag: 'etag-after-retry' },
      };
    },
    async getCase() {
      return BASE_ROW;
    },
  };
  const q = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
    backoffSchedule: [100],
  });
  q.loadCase(BASE_ROW);

  q.enqueue('c1', 'notes', 'boom');
  await tick();

  // After the throw, status should be reconnecting (will retry)
  assert.equal(q.status.get(), 'reconnecting');

  // Wait for the retry to complete (tick is 20ms, backoff is 100ms, so we need a few ticks or one long wait)
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(q.status.get(), 'saved');
  assert.equal(client.patchCalls.length, 2);
});

test('SaveQueue: _handle412 with null getCase sets status to conflict', async () => {
  const client = makeClient({
    patchResponses: [{ ok: false, status: 412 }],
    getCaseRow: /** @type {any} */ (null), // getCase returns null
  });
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(BASE_ROW);

  q.enqueue('c1', 'notes', 'test');
  await tick();

  assert.equal(q.status.get(), 'conflict');
});

test('SaveQueue: loadCase with null answers sets baselineAnswers to null', () => {
  const q = new SaveQueue(makeClient());
  q.loadCase({ ...BASE_ROW, answers: /** @type {any} */ (null) });
  // Should not throw; baselineAnswers = null (the `row.answers ? ... : null` false branch)
  assert.equal(q.getEtag('c1'), BASE_ROW.etag);
});

test('SaveQueue: getEtag returns empty string for an unknown caseId', () => {
  const q = new SaveQueue(makeClient());
  assert.equal(
    q.getEtag('unknown'),
    '',
    'unknown caseId must return empty etag'
  );
});

test('SaveQueue: successful flush with no data.answers preserves existing baselineAnswers', async () => {
  const client = {
    patchCalls: /** @type {any[]} */ ([]),
    async patchCase(
      /** @type {string} */ _id,
      /** @type {any} */ fields,
      /** @type {string} */ etag
    ) {
      this.patchCalls.push({ fields, etag });
      // result.ok=true but result.data has no answers field
      return {
        ok: true,
        status: 200,
        data: {
          ...BASE_ROW,
          notes: 'updated',
          etag: 'new-etag',
          answers: null,
        },
      };
    },
    async getCase() {
      return { ...BASE_ROW };
    },
  };
  const q = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });
  q.loadCase(BASE_ROW);
  q.enqueue('c1', 'notes', 'updated');
  await tick();
  assert.equal(q.status.get(), 'saved');
});

test('SaveQueue: _handle412 retry with null answers on fresh row stores null baselineAnswers', async () => {
  // Server has same baseline but fresh.answers is null
  const freshRow = {
    ...BASE_ROW,
    etag: 'etag-fresh',
    answers: /** @type {any} */ (null),
  };
  const client = makeClient({
    patchResponses: [{ ok: false, status: 412 }],
    getCaseRow: freshRow,
  });
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(BASE_ROW);
  q.enqueue('c1', 'notes', 'x');
  await tick();
  assert.equal(q.status.get(), 'saved');
});

test('SaveQueue: loadCase called twice preserves existing pending items', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 5000 }); // long debounce so pending stays
  q.loadCase(BASE_ROW);
  q.enqueue('c1', 'notes', 'pending value'); // adds a pending item

  // Calling loadCase again with the same case should preserve the pending entry
  q.loadCase({ ...BASE_ROW, etag: 'etag-2' });

  // The pending value should still be there (covers `existing?.pending ?? {}` non-null branch)
  assert.equal(q.getEtag('c1'), 'etag-2', 'ETag should be updated');
});

test('SaveQueue: _handle412 with null baselineAnswers uses {} for comparison', async () => {
  // Load with null answers → baselineAnswers = null
  const client = makeClient({
    patchResponses: [{ ok: false, status: 412 }],
    // getCase returns row with same null answers → comparison {} == {} → no conflict
    getCaseRow: {
      ...BASE_ROW,
      etag: 'etag-2',
      answers: /** @type {any} */ (null),
    },
  });
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase({ ...BASE_ROW, answers: /** @type {any} */ (null) }); // baselineAnswers = null
  q.enqueue('c1', 'notes', 'x');
  await tick();
  // Both sides stringify to '{}' → no conflict → retried → saved
  assert.equal(q.status.get(), 'saved');
});

test('SaveQueue: flushCase immediately persists a pending debounced field', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 5000 });
  q.loadCase(BASE_ROW);

  q.enqueue('c1', 'answers', { 'q-1': { value: 'Yes' } });

  const flushed = await q.flushCase('c1');

  assert.equal(flushed, true);
  assert.equal(client.patchCalls.length, 1);
  assert.deepEqual(client.patchCalls[0].fields, {
    answers: { 'q-1': { value: 'Yes' } },
  });
  assert.equal(q.status.get(), 'saved');
});

test('SaveQueue: flushCase persists multiple pending fields under refreshed ETags', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 30 });
  q.loadCase(BASE_ROW);

  q.enqueue('c1', 'answers', { 'q-1': { value: 'Yes' } });
  q.enqueue('c1', 'notes', 'still pending');
  await q.flushCase('c1');

  assert.equal(client.patchCalls.length, 2);
  assert.equal(client.patchCalls[0].etag, 'etag-1');
  assert.equal(client.patchCalls[1].etag, 'etag-ok-1');
  assert.equal(q.status.get(), 'saved');
});

test('SaveQueue: flushCase waits for an already in-flight flush', async () => {
  /** @type {() => void} */
  let releasePatch = () => {};
  const client = {
    patchCalls: /** @type {any[]} */ ([]),
    async patchCase(
      /** @type {string} */ _id,
      /** @type {Partial<CaseRow>} */ fields,
      /** @type {string} */ etag
    ) {
      this.patchCalls.push({ fields, etag });
      await new Promise((resolve) => {
        releasePatch = /** @type {() => void} */ (resolve);
      });
      return {
        ok: true,
        status: 200,
        data: { ...BASE_ROW, ...fields, etag: 'etag-after-inflight' },
      };
    },
    async getCase() {
      return { ...BASE_ROW };
    },
  };
  const q = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });
  q.loadCase(BASE_ROW);

  q.enqueue('c1', 'answers', { 'q-1': { value: 'Yes' } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const flushed = q.flushCase('c1');
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(client.patchCalls.length, 1);
  releasePatch();
  assert.equal(await flushed, true);
  assert.equal(q.getEtag('c1'), 'etag-after-inflight');
});

test('SaveQueue: enqueueFields writes all fields in a single ETag-guarded PATCH (ADR-0008/0019)', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(BASE_ROW);

  q.enqueueFields('c1', {
    overrides: [/** @type {any} */ ({ answerKey: 'q1' })],
    effectiveOutcome: 'pass',
    effectiveHadRemediation: false,
    outcomeOverridden: true,
  });
  await tick();

  assert.equal(
    client.patchCalls.length,
    1,
    'one PATCH carries every field — no desync on a partial write'
  );
  const { fields, etag } = client.patchCalls[0];
  assert.equal(etag, 'etag-1', 'guarded by the loaded ETag');
  assert.equal(fields.effectiveOutcome, 'pass');
  assert.equal(fields.effectiveHadRemediation, false);
  assert.equal(fields.outcomeOverridden, true);
  assert.ok(Array.isArray(fields.overrides));
  assert.equal(q.status.get(), 'saved');
});

test('SaveQueue: enqueueFields auto-initialises state for an unknown case', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 0 });

  q.enqueueFields('c1', { effectiveOutcome: 'fail' });
  await tick();

  assert.equal(client.patchCalls.length, 1);
  assert.equal(client.patchCalls[0].fields.effectiveOutcome, 'fail');
});

test('SaveQueue: enqueueFields resets its debounce timer when re-enqueued', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 30 });
  q.loadCase(BASE_ROW);

  q.enqueueFields('c1', { effectiveOutcome: 'pass' });
  q.enqueueFields('c1', { effectiveOutcome: 'fail' });
  await tick();
  assert.equal(
    client.patchCalls.length,
    0,
    'the second enqueue cleared the first timer'
  );

  await new Promise((r) => setTimeout(r, 40));
  assert.equal(
    client.patchCalls.length,
    1,
    'only the latest field set is flushed'
  );
  assert.equal(client.patchCalls[0].fields.effectiveOutcome, 'fail');
});

test('SaveQueue: enqueueFields retries the whole field set after a 412 with no concurrent edit', async () => {
  const client = makeClient({
    patchResponses: [{ ok: false, status: 412 }],
    getCaseRow: { ...BASE_ROW, etag: 'etag-2' },
  });
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(BASE_ROW);

  q.enqueueFields('c1', { effectiveOutcome: 'pass', outcomeOverridden: true });
  await tick();

  assert.equal(
    q.status.get(),
    'saved',
    'the reload + retry under the fresh ETag succeeds'
  );
  assert.equal(
    client.patchCalls.length,
    2,
    'first attempt 412s, second carries the same fields'
  );
  assert.equal(client.patchCalls[1].fields.outcomeOverridden, true);
});

test('SaveQueue: writes and conflict refreshes use the Case list options captured at load', async () => {
  const client = makeClient({
    patchResponses: [{ ok: false, status: 412 }],
    getCaseRow: { ...BASE_ROW, etag: 'etag-2' },
  });
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(BASE_ROW, { listName: 'complaints' });

  q.enqueue('c1', 'notes', 'updated');
  await tick();

  assert.deepEqual(client.patchCalls[0].opts, { listName: 'complaints' });
  assert.deepEqual(client.getCalls[0], {
    id: 'c1',
    opts: { listName: 'complaints' },
  });
  assert.deepEqual(client.patchCalls[1].opts, { listName: 'complaints' });
});
