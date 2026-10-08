// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaveQueue } from '../src/services/save-queue.js';
import { makeCaseRow } from './helpers/fixtures.js';

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').PatchResult} PatchResult */

function deferred() {
  /** @type {(value?: unknown) => void} */
  let resolve = () => {};
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function makeTimer() {
  let nextId = 1;
  /** @type {Map<number, () => void>} */
  const callbacks = new Map();
  return {
    setTimer(/** @type {() => void} */ callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    clearTimer(/** @type {unknown} */ timerId) {
      callbacks.delete(/** @type {number} */ (timerId));
    },
    runAll() {
      const ready = [...callbacks.values()];
      callbacks.clear();
      for (const callback of ready) callback();
    },
    get size() {
      return callbacks.size;
    },
  };
}

/**
 * @param {Partial<CaseRow>} [overrides]
 * @returns {CaseRow}
 */
function caseRow(overrides = {}) {
  return makeCaseRow({
    id: 'c1',
    caseType: 'test',
    title: 'Test Case',
    assignedReviewer: 'u1',
    responsibleParty: 'u2',
    ...overrides,
  });
}

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
  let liveRow = caseRow();

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
    async listCases() {
      return [];
    },
    async countCases() {
      return 0;
    },
    async getCurrentUserGroups() {
      return [];
    },
    async getCurrentUser() {
      return { id: 'user-test', displayName: 'Test User' };
    },
    async listRoadmapItems() {
      return [];
    },
    async searchPeople() {
      return [];
    },
    async resolveUsers() {
      return {};
    },
    async resolveManagers() {
      return {};
    },
    async getBankVersion() {
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
  q.loadCase(caseRow());
  q.enqueue('c1', 'notes', 'hello');
  assert.equal(q.status.get(), 'saving');
});

test('SaveQueue: subscribeStatus delivers current and future statuses until unsubscribed', async () => {
  const timer = makeTimer();
  const q = new SaveQueue(makeClient(), {
    debounceMs: 0,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });
  q.loadCase(caseRow());
  /** @type {import('../src/services/save-queue.js').SaveStatus[]} */
  const statuses = [];
  const unsubscribe = q.subscribeStatus((status) => statuses.push(status));

  assert.deepEqual(
    statuses,
    ['saved'],
    'current status is delivered immediately'
  );
  q.enqueue('c1', 'notes', 'hello');
  assert.deepEqual(statuses, ['saved', 'saving']);
  timer.runAll();
  await q.whenIdle();
  assert.deepEqual(statuses, ['saved', 'saving', 'saved']);

  unsubscribe();
  q.enqueue('c1', 'notes', 'after unsubscribe');
  assert.deepEqual(
    statuses,
    ['saved', 'saving', 'saved'],
    'unsubscribe stops future delivery'
  );
  timer.runAll();
  await q.whenIdle();
});

// --- debounce ---

test('SaveQueue: rapid calls to same field result in exactly one PATCH', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(caseRow());

  q.enqueue('c1', 'notes', 'a');
  q.enqueue('c1', 'notes', 'b');
  q.enqueue('c1', 'notes', 'c');

  await q.whenIdle();

  assert.equal(client.patchCalls.length, 1);
  assert.deepEqual(client.patchCalls[0].fields, { notes: 'c' });
});

test('SaveQueue: different fields each get their own debounced PATCH', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(caseRow());

  q.enqueue('c1', 'notes', 'my note');
  q.enqueue('c1', 'status', 'In-progress');

  await q.whenIdle();

  assert.equal(client.patchCalls.length, 2);
});

// --- ETag ---

test('SaveQueue: PATCH is sent with the stored ETag', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(caseRow()); // etag = 'etag-1'

  q.enqueue('c1', 'notes', 'x');
  await q.whenIdle();

  assert.equal(client.patchCalls[0].etag, 'etag-1');
});

test('SaveQueue: on success the stored ETag is updated for subsequent PATCHes', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(caseRow());

  q.enqueue('c1', 'notes', 'first');
  await q.whenIdle();
  const etag1 = client.patchCalls[0].etag;

  q.enqueue('c1', 'notes', 'second');
  await q.whenIdle();
  const etag2 = client.patchCalls[1].etag;

  assert.notEqual(etag1, etag2);
});

// --- success status ---

test('SaveQueue: status is saved after successful PATCH', async () => {
  const q = new SaveQueue(makeClient(), { debounceMs: 0 });
  q.loadCase(caseRow());

  q.enqueue('c1', 'notes', 'hello');
  await q.whenIdle();

  assert.equal(q.status.get(), 'saved');
});

// --- network retry ---

test('SaveQueue: on non-412 error status becomes reconnecting', async () => {
  const client = makeClient({
    patchResponses: [{ ok: false, status: 503 }],
  });
  const retry = deferred();
  const retryStarted = deferred();
  const q = new SaveQueue(client, {
    debounceMs: 0,
    sleep: async () => {
      retryStarted.resolve();
      await retry.promise;
    },
  });
  q.loadCase(caseRow());

  q.enqueue('c1', 'notes', 'hello');
  await retryStarted.promise;

  assert.equal(q.status.get(), 'reconnecting');
  retry.resolve();
  await q.whenIdle();
});

test('SaveQueue: retries after network failure and eventually saves', async () => {
  const client = makeClient({
    patchResponses: [
      { ok: false, status: 503 },
      { ok: false, status: 503 },
    ],
  });
  const q = new SaveQueue(client, { debounceMs: 0, backoffSchedule: [0] });
  q.loadCase(caseRow());

  q.enqueue('c1', 'notes', 'hello');
  // One completion signal covers debounce → fail → retry → fail → retry → success.
  await q.whenIdle();

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
  q.loadCase(caseRow()); // baselineAnswers = {}

  q.enqueue('c1', 'notes', 'hello');
  await q.whenIdle();

  assert.equal(q.status.get(), 'saved');
  assert.equal(client.patchCalls.length, 2);
});

test('SaveQueue: 412 non-conflicting: retry uses refreshed ETag', async () => {
  // Server has etag-2 but same answers after the 412
  const freshRow = caseRow({ etag: 'etag-2', answers: {} });
  const client = makeClient({
    patchResponses: [{ ok: false, status: 412 }],
    getCaseRow: freshRow,
  });
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(caseRow());

  q.enqueue('c1', 'notes', 'hello');
  await q.whenIdle();

  assert.equal(client.patchCalls.length, 2);
  assert.equal(client.patchCalls[1].etag, 'etag-2');
});

// --- 412 conflict ---

test('SaveQueue: 412 with changed remote answers sets status to conflict', async () => {
  // Server now has different answers than our baseline
  const freshRow = caseRow({
    etag: 'etag-2',
    answers: { 'q-1': { value: 'Yes' } },
  });
  const client = makeClient({
    patchResponses: [{ ok: false, status: 412 }],
    getCaseRow: freshRow,
  });
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(caseRow()); // baselineAnswers = {}

  q.enqueue('c1', 'notes', 'hello');
  await q.whenIdle();

  assert.equal(q.status.get(), 'conflict');
});

test('SaveQueue: conflict does not trigger a retry PATCH', async () => {
  const freshRow = caseRow({
    etag: 'etag-2',
    answers: { 'q-1': { value: 'Yes' } },
  });
  const client = makeClient({
    patchResponses: [{ ok: false, status: 412 }],
    getCaseRow: freshRow,
  });
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(caseRow());

  q.enqueue('c1', 'notes', 'hello');
  await q.whenIdle();

  assert.equal(client.patchCalls.length, 1);
});

test('SaveQueue: enqueue for unknown caseId auto-creates state and sends PATCH', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 0 });
  // Do NOT call loadCase — the caseId is unknown

  q.enqueue('unknown-case', 'notes', 'auto-created');
  await q.whenIdle();

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
        data: caseRow({ etag: 'etag-after-retry' }),
      };
    },
    async getCase() {
      return caseRow();
    },
  };
  const retry = deferred();
  const retryStarted = deferred();
  const q = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
    sleep: async () => {
      retryStarted.resolve();
      await retry.promise;
    },
  });
  q.loadCase(caseRow());

  q.enqueue('c1', 'notes', 'boom');
  await retryStarted.promise;

  // After the throw, status should be reconnecting (will retry)
  assert.equal(q.status.get(), 'reconnecting');

  retry.resolve();
  await q.whenIdle();
  assert.equal(q.status.get(), 'saved');
  assert.equal(client.patchCalls.length, 2);
});

test('SaveQueue: a 412 with no way to re-read the Case surfaces a conflict rather than retrying blind', async () => {
  const client = makeClient({
    patchResponses: [{ ok: false, status: 412 }],
    getCaseRow: /** @type {any} */ (null),
  });
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(caseRow());

  q.enqueue('c1', 'notes', 'test');
  await q.whenIdle();

  assert.equal(
    q.status.get(),
    'conflict',
    'the queue surfaces the failed re-read as a conflict'
  );
  assert.equal(
    client.patchCalls.length,
    1,
    'the queue does not retry without a fresh Case and ETag'
  );
});

test('SaveQueue: getEtag returns empty string for an unknown caseId', () => {
  const q = new SaveQueue(makeClient());
  assert.equal(
    q.getEtag('unknown'),
    '',
    'unknown caseId must return empty etag'
  );
});

test('SaveQueue: a Case with no Answers round-trips a 412 without a false conflict', async () => {
  const client = makeClient({
    patchResponses: [
      { ok: false, status: 412 },
      {
        ok: true,
        status: 200,
        data: caseRow({
          answers: /** @type {any} */ (null),
          etag: 'etag-after-retry',
        }),
      },
    ],
    getCaseRow: caseRow({
      answers: /** @type {any} */ (null),
      etag: 'etag-fresh',
    }),
  });
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(caseRow({ answers: /** @type {any} */ (null) }));

  q.enqueueFields('c1', { notes: 'a note' });
  await q.whenIdle();

  assert.equal(
    q.status.get(),
    'saved',
    'the retry succeeded without surfacing a false conflict'
  );
  assert.equal(
    client.patchCalls.length,
    2,
    'the write is retried once under the fresh ETag'
  );
  assert.deepEqual(
    client.patchCalls.at(-1)?.fields,
    { notes: 'a note' },
    'the retry carries the same fields rather than a merged Answers value'
  );
});

test('SaveQueue: a successful response without Answers preserves the baseline for a later 412', async () => {
  const answers = { 'q-1': { value: 'Yes' } };
  const client = makeClient({
    patchResponses: [
      {
        ok: true,
        status: 200,
        data: caseRow({
          answers: /** @type {any} */ (null),
          etag: 'etag-after-first-save',
        }),
      },
      { ok: false, status: 412 },
      {
        ok: true,
        status: 200,
        data: caseRow({ answers, etag: 'etag-after-retry' }),
      },
    ],
    getCaseRow: caseRow({ answers, etag: 'etag-fresh' }),
  });
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(caseRow({ answers }));

  q.enqueueFields('c1', { notes: 'first save' });
  await q.whenIdle();
  q.enqueueFields('c1', { notes: 'second save' });
  await q.whenIdle();

  assert.equal(q.status.get(), 'saved');
  assert.equal(
    client.patchCalls.length,
    3,
    'the later 412 retries because the successful response kept the baseline'
  );
  assert.deepEqual(client.patchCalls[2].fields, { notes: 'second save' });
  assert.equal(client.patchCalls[2].etag, 'etag-fresh');
});

test('SaveQueue: a second loadCase for the same Case does not discard writes already queued', async () => {
  const client = makeClient();
  const timer = makeTimer();
  const q = new SaveQueue(client, {
    debounceMs: 5000,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });
  q.loadCase(caseRow());
  q.enqueue('c1', 'notes', 'pending value');

  q.loadCase(caseRow({ etag: 'etag-2' }));
  await q.flushCase('c1');

  assert.equal(
    client.patchCalls.length,
    1,
    'the queued write is persisted once'
  );
  assert.deepEqual(
    client.patchCalls[0].fields,
    { notes: 'pending value' },
    'the pending write survives the second load'
  );
  assert.equal(
    client.patchCalls[0].etag,
    'etag-2',
    'the pending write uses the ETag from the second load'
  );
});

test('SaveQueue: flushCase immediately persists a pending debounced field', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 5000 });
  q.loadCase(caseRow());

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
  q.loadCase(caseRow());

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
        data: caseRow({ ...fields, etag: 'etag-after-inflight' }),
      };
    },
    async getCase() {
      return caseRow();
    },
  };
  const timer = makeTimer();
  const q = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });
  q.loadCase(caseRow());

  q.enqueue('c1', 'answers', { 'q-1': { value: 'Yes' } });
  timer.runAll();
  assert.equal(client.patchCalls.length, 1, 'the timer started the write');
  const flushed = q.flushCase('c1');

  assert.equal(client.patchCalls.length, 1);
  releasePatch();
  assert.equal(await flushed, true);
  assert.equal(q.getEtag('c1'), 'etag-after-inflight');
});

test('SaveQueue: enqueueFields writes all fields in a single ETag-guarded PATCH', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(caseRow());

  // The reporting columns an Amended Outcome re-stamps together.
  q.enqueueFields('c1', {
    effectiveOutcome: 'pass',
    effectiveHadRemediation: false,
    outcomeOverridden: true,
  });
  await q.whenIdle();

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
  assert.equal(q.status.get(), 'saved');
});

test('SaveQueue: enqueueFields auto-initialises state for an unknown case', async () => {
  const client = makeClient();
  const q = new SaveQueue(client, { debounceMs: 0 });

  q.enqueueFields('c1', { effectiveOutcome: 'fail' });
  await q.whenIdle();

  assert.equal(client.patchCalls.length, 1);
  assert.equal(client.patchCalls[0].fields.effectiveOutcome, 'fail');
});

test('SaveQueue: enqueueFields resets its debounce timer when re-enqueued', async () => {
  const client = makeClient();
  const timer = makeTimer();
  const q = new SaveQueue(client, {
    debounceMs: 30,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });
  q.loadCase(caseRow());

  q.enqueueFields('c1', { effectiveOutcome: 'pass' });
  q.enqueueFields('c1', { effectiveOutcome: 'fail' });
  assert.equal(timer.size, 1, 'the second enqueue cleared the first timer');

  timer.runAll();
  await q.whenIdle();
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
    getCaseRow: caseRow({ etag: 'etag-2' }),
  });
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(caseRow());

  q.enqueueFields('c1', { effectiveOutcome: 'pass', outcomeOverridden: true });
  await q.whenIdle();

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
    getCaseRow: caseRow({ etag: 'etag-2' }),
  });
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(caseRow(), { listName: 'complaints' });

  q.enqueue('c1', 'notes', 'updated');
  await q.whenIdle();

  assert.deepEqual(client.patchCalls[0].opts, { listName: 'complaints' });
  assert.deepEqual(client.getCalls[0], {
    id: 'c1',
    opts: { listName: 'complaints' },
  });
  assert.deepEqual(client.patchCalls[1].opts, { listName: 'complaints' });
});

test('SaveQueue: a queued write survives navigation — the mount signal never reaches a write', async () => {
  const client = makeClient();
  const controller = new AbortController();
  const q = new SaveQueue(client, { debounceMs: 0 });
  // A page that reads with the mount-lifetime signal may hand the very same
  // options bag to loadCase. The queue must drop the signal: a Reviewer's edit
  // is persisted whether or not they are still looking at the Case.
  q.loadCase(caseRow(), {
    listName: 'complaints',
    signal: controller.signal,
  });

  q.enqueue('c1', 'notes', 'typed then navigated away');
  controller.abort();
  await q.whenIdle();

  assert.equal(client.patchCalls.length, 1, 'the write was still issued');
  assert.deepEqual(
    client.patchCalls[0].opts,
    { listName: 'complaints' },
    'the write carries no AbortSignal'
  );
  assert.equal(client.patchCalls[0].fields.notes, 'typed then navigated away');
  assert.equal(q.status.get(), 'saved');
});

test('SaveQueue: a conflict re-read after navigation is not cancelled either', async () => {
  const client = makeClient({
    patchResponses: [{ ok: false, status: 412 }],
    getCaseRow: caseRow({ etag: 'etag-2' }),
  });
  const controller = new AbortController();
  const q = new SaveQueue(client, { debounceMs: 0 });
  q.loadCase(caseRow(), {
    listName: 'complaints',
    signal: controller.signal,
  });

  q.enqueue('c1', 'notes', 'updated');
  controller.abort();
  await q.whenIdle();

  assert.deepEqual(client.getCalls[0], {
    id: 'c1',
    opts: { listName: 'complaints' },
  });
  assert.equal(q.status.get(), 'saved');
});

// --- writes that can never succeed ---

/** Let every promise already settled, and the writes they started, run. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Debounce timers that fire on the next microtask, so `tick` is enough. */
const IMMEDIATE = {
  setTimer: (/** @type {() => void} */ callback) => {
    queueMicrotask(callback);
    return 0;
  },
  clearTimer: () => {},
};

/** @param {import('../src/services/save-queue.js').SaveQueue} queue */
function recordStatuses(queue) {
  /** @type {{ status: string, failures: any[], longOutage: boolean }[]} */
  const seen = [];
  queue.subscribeStatus((status, detail) =>
    seen.push({
      status,
      failures: detail.failures,
      longOutage: detail.longOutage,
    })
  );
  return seen;
}

/**
 * A client whose PATCHes wait for the test to answer them, one gate per call,
 * so a test can hold one field's write open while another field's lands.
 */
function makeGatedClient() {
  /** @type {{ fields: Partial<CaseRow>, answer: (r: PatchResult) => void }[]} */
  const calls = [];
  return {
    calls,
    client: /** @type {any} */ ({
      patchCase: (
        /** @type {string} */ _id,
        /** @type {Partial<CaseRow>} */ fields
      ) => new Promise((answer) => calls.push({ fields, answer })),
      getCase: async () => caseRow(),
    }),
  };
}

test('SaveQueue: a refused value gives up after one attempt, settles failed and says why', async () => {
  const client = makeClient({
    patchResponses: [
      {
        ok: false,
        status: 400,
        failure: { reason: 'invalid-value', message: 'bad character' },
      },
    ],
  });
  const q = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });
  q.loadCase(caseRow({ notes: 'before' }));
  const seen = recordStatuses(q);

  q.enqueue('c1', 'notes', 'pasted\u0008text');
  await q.whenIdle();

  assert.equal(client.patchCalls.length, 1, 'nothing is retried');
  assert.equal(q.status.get(), 'failed');
  const last = seen.at(-1);
  assert.equal(last?.status, 'failed');
  assert.equal(last?.failures.length, 1);
  assert.deepEqual(last?.failures[0].fields, ['notes']);
  assert.equal(last?.failures[0].caseId, 'c1');
  assert.equal(last?.failures[0].failure.reason, 'invalid-value');
  assert.equal(last?.longOutage, false);
});

test('SaveQueue: a failure with no reason attached is classified from its status', async () => {
  for (const [status, reason] of /** @type {const} */ ([
    [400, 'invalid-value'],
    [403, 'forbidden'],
    [404, 'not-found'],
  ])) {
    const client = makeClient({ patchResponses: [{ ok: false, status }] });
    const q = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });
    q.loadCase(caseRow());
    const seen = recordStatuses(q);

    q.enqueue('c1', 'notes', 'x');
    await q.whenIdle();

    assert.equal(client.patchCalls.length, 1, `${status} is not retried`);
    assert.equal(seen.at(-1)?.failures[0].failure.reason, reason);
  }
});

test('SaveQueue: a Responsible Party SharePoint cannot find gives up at once and says which person', async () => {
  const client = makeClient({
    patchResponses: [
      {
        ok: false,
        status: 500,
        failure: { reason: 'person-not-found', account: 'u4' },
      },
    ],
  });
  const q = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });
  q.loadCase(caseRow({ responsibleParty: 'u2' }));
  const seen = recordStatuses(q);

  q.enqueue('c1', 'responsibleParty', 'u4');
  await q.whenIdle();

  const notice = seen.at(-1)?.failures[0];
  assert.equal(notice.failure.reason, 'person-not-found');
  assert.equal(notice.failure.account, 'u4');
  assert.deepEqual(notice.fields, ['responsibleParty']);
  assert.equal(client.patchCalls.length, 1);
});

test('SaveQueue: a lost connection keeps retrying and becomes a long outage past the backoff schedule', async () => {
  const client = makeClient({
    patchResponses: [
      { ok: false, status: 0 },
      { ok: false, status: 503 },
      { ok: false, status: 503 },
      { ok: false, status: 503 },
    ],
  });
  const q = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
    backoffSchedule: [1, 2],
    sleep: async () => {},
  });
  q.loadCase(caseRow());
  const seen = recordStatuses(q);

  q.enqueue('c1', 'notes', 'hello');
  await q.whenIdle();

  assert.equal(client.patchCalls.length, 5, 'four failures, then it lands');
  const reconnecting = seen.filter((s) => s.status === 'reconnecting');
  assert.equal(reconnecting.length, 4, 'every retry re-announces');
  assert.deepEqual(
    reconnecting.map((s) => s.longOutage),
    [false, false, true, true],
    'long once the attempts have run past the schedule'
  );
  assert.deepEqual(
    { status: seen.at(-1)?.status, long: seen.at(-1)?.longOutage },
    { status: 'saved', long: false },
    'and the outage ends when the write lands'
  );
  assert.equal(seen.at(-1)?.failures.length, 0);
});

test('SaveQueue: an unclassified failure gets two more attempts and then gives up', async () => {
  const client = makeClient({
    patchResponses: [
      { ok: false, status: 418 },
      { ok: false, status: 418 },
      { ok: false, status: 418 },
      { ok: false, status: 418 },
    ],
  });
  const q = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
    backoffSchedule: [0],
    sleep: async () => {},
  });
  q.loadCase(caseRow());
  const seen = recordStatuses(q);

  q.enqueue('c1', 'notes', 'hello');
  await q.whenIdle();

  assert.equal(client.patchCalls.length, 3, 'the first send and two more');
  assert.equal(q.status.get(), 'failed');
  assert.equal(seen.at(-1)?.failures[0].failure.reason, 'unknown');
  assert.ok(
    !seen.some((s) => s.status === 'reconnecting'),
    'a fault that is not the connection never claims to be'
  );
});

test('SaveQueue: an unclassified failure that clears on a retry is not reported', async () => {
  const client = makeClient({ patchResponses: [{ ok: false, status: 418 }] });
  const q = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
    backoffSchedule: [0],
    sleep: async () => {},
  });
  q.loadCase(caseRow());

  q.enqueue('c1', 'notes', 'hello');
  await q.whenIdle();

  assert.equal(client.patchCalls.length, 2);
  assert.equal(q.status.get(), 'saved');
});

test('SaveQueue: a later successful write of the same field clears its failure', async () => {
  const client = makeClient({ patchResponses: [{ ok: false, status: 400 }] });
  const q = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });
  q.loadCase(caseRow());
  const seen = recordStatuses(q);

  q.enqueue('c1', 'notes', 'bad');
  await q.whenIdle();
  assert.equal(q.status.get(), 'failed');

  q.enqueue('c1', 'notes', 'fixed');
  assert.equal(
    q.status.get(),
    'failed',
    'a new write does not hide the failure still standing'
  );
  await q.whenIdle();

  assert.equal(q.status.get(), 'saved');
  assert.deepEqual(seen.at(-1)?.failures, []);
});

test('SaveQueue: a newer failure for the same field replaces the one before it', async () => {
  const client = makeClient({
    patchResponses: [
      { ok: false, status: 400 },
      { ok: false, status: 403 },
    ],
  });
  const q = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });
  q.loadCase(caseRow());
  const seen = recordStatuses(q);

  q.enqueue('c1', 'notes', 'one');
  await q.whenIdle();
  q.enqueue('c1', 'notes', 'two');
  await q.whenIdle();

  assert.equal(seen.at(-1)?.failures.length, 1);
  assert.equal(seen.at(-1)?.failures[0].failure.reason, 'forbidden');
});

test('SaveQueue: another field still saves, and the queue goes idle, while a failure is recorded', async () => {
  const client = makeClient({ patchResponses: [{ ok: false, status: 400 }] });
  const q = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });
  q.loadCase(caseRow());
  const seen = recordStatuses(q);

  q.enqueue('c1', 'notes', 'bad');
  await q.whenIdle();
  q.enqueue('c1', 'answers', { 'q-1': { value: 'Yes' } });
  await q.whenIdle();

  assert.equal(client.patchCalls.length, 2);
  assert.deepEqual(client.patchCalls[1].fields, {
    answers: { 'q-1': { value: 'Yes' } },
  });
  assert.equal(q.status.get(), 'failed', 'the notes failure still stands');
  assert.deepEqual(
    seen.at(-1)?.failures.map((n) => n.fields),
    [['notes']]
  );
});

test('SaveQueue: flushCase returns false at once when a write gives up, instead of hanging', async () => {
  const client = makeClient({ patchResponses: [{ ok: false, status: 400 }] });
  const q = new SaveQueue(/** @type {any} */ (client), { debounceMs: 60_000 });
  q.loadCase(caseRow());

  q.enqueue('c1', 'notes', 'bad');

  assert.equal(await q.flushCase('c1'), false);
  assert.equal(client.patchCalls.length, 1);
  assert.equal(q.status.get(), 'failed');
});

test('SaveQueue: flushCase refuses to complete a Case that still has an unsaved edit', async () => {
  const client = makeClient({ patchResponses: [{ ok: false, status: 400 }] });
  const q = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });
  q.loadCase(caseRow());
  q.enqueue('c1', 'notes', 'bad');
  await q.whenIdle();

  assert.equal(await q.flushCase('c1'), false, 'nothing pending, still false');

  q.loadCase(caseRow({ id: 'c2' }));
  assert.equal(await q.flushCase('c2'), true, 'another Case is unaffected');
});

test('SaveQueue: flushCase waits out an in-flight write that is given up on', async () => {
  const { client, calls } = makeGatedClient();
  const q = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
    ...IMMEDIATE,
  });
  q.loadCase(caseRow());
  q.enqueue('c1', 'notes', 'bad');
  await tick();
  const flushed = q.flushCase('c1');

  calls[0].answer({ ok: false, status: 400 });

  assert.equal(await flushed, false);
});

test('SaveQueue: a recorded failure outranks a lost connection and a newer write', async () => {
  const { client, calls } = makeGatedClient();
  const q = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
    ...IMMEDIATE,
    sleep: () => new Promise(() => {}),
  });
  q.loadCase(caseRow());
  const seen = recordStatuses(q);

  q.enqueue('c1', 'notes', 'bad');
  await tick();
  calls[0].answer({ ok: false, status: 400 });
  await q.whenIdle();
  q.enqueue('c1', 'answers', { 'q-1': { value: 'Yes' } });
  await tick();
  calls[1].answer({ ok: false, status: 503 });
  await tick();

  assert.deepEqual(
    seen.slice(-2).map((s) => s.status),
    ['failed', 'failed'],
    'saving and reconnecting both give way to the standing failure'
  );
});

test('SaveQueue: a write started during an outage does not hide it, and ending the outage returns to saving', async () => {
  const { client, calls } = makeGatedClient();
  /** @type {() => void} */
  let wake = () => {};
  const q = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
    ...IMMEDIATE,
    sleep: () =>
      new Promise((resolve) => {
        wake = resolve;
      }),
  });
  q.loadCase(caseRow());

  q.enqueue('c1', 'notes', 'a');
  await tick();
  calls[0].answer({ ok: false, status: 503 });
  await tick();
  assert.equal(q.status.get(), 'reconnecting');

  q.enqueue('c1', 'answers', { 'q-1': { value: 'Yes' } });
  assert.equal(q.status.get(), 'reconnecting', 'not masked by the newer write');
  await tick();

  wake();
  await tick();
  calls[2].answer({ ok: true, status: 200, data: caseRow({ etag: 'e2' }) });
  await tick();
  assert.equal(
    q.status.get(),
    'saving',
    'the outage is over but the other write is still in hand'
  );

  calls[1].answer({ ok: true, status: 200, data: caseRow({ etag: 'e3' }) });
  await q.whenIdle();
  assert.equal(q.status.get(), 'saved');
});

test('SaveQueue: a conflict stays a conflict while another write finishes', async () => {
  const { client, calls } = makeGatedClient();
  client.getCase = async () => caseRow({ answers: { 'q-1': { value: 'No' } } });
  const q = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
    ...IMMEDIATE,
  });
  q.loadCase(caseRow());
  const seen = recordStatuses(q);

  q.enqueue('c1', 'notes', 'a');
  q.enqueue('c1', 'answers', { 'q-1': { value: 'Yes' } });
  await tick();
  calls[0].answer({ ok: false, status: 412 });
  await tick();
  assert.equal(q.status.get(), 'conflict');
  const announced = seen.length;

  calls[1].answer({ ok: true, status: 200, data: caseRow({ etag: 'e2' }) });
  await q.whenIdle();

  assert.equal(q.status.get(), 'conflict');
  assert.equal(seen.length, announced, 'nothing was re-announced over it');
});

test('SaveQueue: a conflict outranks a failure when the queue settles', async () => {
  const client = makeClient({
    patchResponses: [
      { ok: false, status: 400 },
      { ok: false, status: 412 },
    ],
    getCaseRow: caseRow({ answers: { 'q-1': { value: 'No' } } }),
  });
  const q = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });
  q.loadCase(caseRow());

  q.enqueue('c1', 'notes', 'bad');
  await q.whenIdle();
  q.enqueue('c1', 'answers', { 'q-1': { value: 'Yes' } });
  await q.whenIdle();

  assert.equal(q.status.get(), 'conflict');
});

test('SaveQueue: a write that settles while another is still waiting out an outage keeps saying so', async () => {
  const { client, calls } = makeGatedClient();
  const q = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
    ...IMMEDIATE,
    sleep: () => new Promise(() => {}),
  });
  q.loadCase(caseRow());

  q.enqueue('c1', 'notes', 'a');
  await tick();
  calls[0].answer({ ok: false, status: 503 });
  await tick();
  q.enqueue('c1', 'answers', { 'q-1': { value: 'Yes' } });
  await tick();
  calls[1].answer({ ok: true, status: 200, data: caseRow({ etag: 'e2' }) });
  await tick();

  assert.equal(q.status.get(), 'reconnecting');
});

test('SaveQueue: a write that settles beside others still in hand leaves a standing failure showing', async () => {
  const { client, calls } = makeGatedClient();
  const q = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
    ...IMMEDIATE,
  });
  q.loadCase(caseRow());

  q.enqueue('c1', 'notes', 'bad');
  await tick();
  calls[0].answer({ ok: false, status: 400 });
  await q.whenIdle();
  q.enqueue('c1', 'answers', { 'q-1': { value: 'Yes' } });
  q.enqueue('c1', 'conversation', []);
  await tick();
  calls[1].answer({ ok: true, status: 200, data: caseRow({ etag: 'e2' }) });
  await tick();

  assert.equal(q.status.get(), 'failed');
  calls[2].answer({ ok: true, status: 200, data: caseRow({ etag: 'e3' }) });
  await q.whenIdle();
  assert.equal(q.status.get(), 'failed');
});

test('SaveQueue: whenIdle resolves at once when nothing is queued', async () => {
  const q = new SaveQueue(/** @type {any} */ (makeClient()));
  await q.whenIdle();
  assert.equal(q.status.get(), 'saved');
});
