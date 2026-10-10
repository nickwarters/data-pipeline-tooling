// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaveQueue } from '../src/services/save-queue.js';

// Capability: the queue saves anything a target can write and re-read, judges
// a rejected write by the target's own conflict rule, records when a save last
// succeeded, and refuses to queue a write for an item loaded read-only.

/** @typedef {import('../src/services/save-queue.js').SaveTarget} SaveTarget */
/** @typedef {{ id: string, etag: string, fields: Record<string, unknown> }} Item */

function makeTimer() {
  let nextId = 1;
  /** @type {Map<number, () => void>} */
  const callbacks = new Map();
  return {
    setTimer(/** @type {() => void} */ callback) {
      callbacks.set(nextId, callback);
      return nextId++;
    },
    clearTimer(/** @type {unknown} */ timerId) {
      callbacks.delete(/** @type {number} */ (timerId));
    },
    runAll() {
      const ready = [...callbacks.values()];
      callbacks.clear();
      for (const callback of ready) callback();
    },
  };
}

/**
 * An in-memory store behind a target whose conflict rule is per field: a
 * rejected write conflicts only when a field it carries moved since loading.
 *
 * @param {Item} initial
 * @param {{ failures?: number }} [options] transient failures before success
 */
function fieldStore(initial, { failures = 0 } = {}) {
  let live = structuredClone(initial);
  let version = 1;
  let failuresLeft = failures;
  /** @type {Array<{ fields: Record<string, unknown>, etag: string }>} */
  const patches = [];
  /** @type {SaveTarget} */
  const target = {
    async patch(_id, fields, etag) {
      patches.push({ fields, etag });
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        return { ok: false, status: 503 };
      }
      if (etag !== live.etag) return { ok: false, status: 412 };
      live = {
        ...live,
        etag: `"${++version}"`,
        fields: { ...live.fields, ...fields },
      };
      return { ok: true, status: 200, data: structuredClone(live) };
    },
    async get() {
      return structuredClone(live);
    },
    baseline: (item) => structuredClone(/** @type {Item} */ (item).fields),
    isConflict: (baseline, fresh, fields) =>
      Object.keys(fields).some(
        (column) =>
          /** @type {any} */ (baseline)[column] !==
          /** @type {Item} */ (fresh).fields[column]
      ),
  };
  return {
    target,
    patches,
    /** Somebody else's write, straight to the store. @param {Record<string, unknown>} fields */
    editElsewhere(fields) {
      live = {
        ...live,
        etag: `"${++version}"`,
        fields: { ...live.fields, ...fields },
      };
    },
    live: () => live,
  };
}

const FORM = {
  id: '7',
  etag: '"1"',
  fields: { Wellbeing: 'Fine', LineManagerComments: '' },
};

/** @param {SaveTarget} target @param {() => Date} [now] */
function queueFor(target, now) {
  const timer = makeTimer();
  const queue = new SaveQueue(/** @type {any} */ ({}), {
    target,
    now,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    sleep: async () => {},
  });
  return { queue, timer };
}

test('a queue handed a target debounces an edit and writes it through that target, guarded by the loaded ETag', async () => {
  const store = fieldStore(FORM);
  const { queue, timer } = queueFor(store.target);
  queue.loadCase(FORM);

  queue.enqueue('7', 'Wellbeing', 'Tired');
  queue.enqueue('7', 'Wellbeing', 'Better');
  assert.equal(store.patches.length, 0, 'nothing is sent before the debounce');
  timer.runAll();
  await queue.whenIdle();

  assert.deepEqual(store.patches, [
    { fields: { Wellbeing: 'Better' }, etag: '"1"' },
  ]);
  assert.equal(queue.getEtag('7'), store.live().etag);
  assert.equal(queue.status.get(), 'saved');
});

test('a write that fails for a passing reason is retried until it lands', async () => {
  const store = fieldStore(FORM, { failures: 2 });
  const { queue, timer } = queueFor(store.target);
  queue.loadCase(FORM);
  /** @type {string[]} */
  const statuses = [];
  queue.subscribeStatus((status) => statuses.push(status));

  queue.enqueue('7', 'Wellbeing', 'Better');
  timer.runAll();
  await queue.whenIdle();

  assert.equal(store.patches.length, 3);
  assert.equal(store.live().fields.Wellbeing, 'Better');
  assert.deepEqual(statuses, [
    'saved',
    'saving',
    'reconnecting',
    'reconnecting',
    'saved',
  ]);
});

test('a remote change to the field being saved is a conflict, and the write is not forced through', async () => {
  const store = fieldStore(FORM);
  const { queue, timer } = queueFor(store.target);
  queue.loadCase(FORM);
  store.editElsewhere({ Wellbeing: 'Changed by the manager' });

  queue.enqueue('7', 'Wellbeing', 'Mine');
  timer.runAll();
  await queue.whenIdle();

  assert.equal(queue.status.get(), 'conflict');
  assert.equal(store.live().fields.Wellbeing, 'Changed by the manager');
});

test('a remote change to a different field is retried past on the fresh ETag', async () => {
  const store = fieldStore(FORM);
  const { queue, timer } = queueFor(store.target);
  queue.loadCase(FORM);
  store.editElsewhere({ LineManagerComments: 'Good month.' });

  queue.enqueue('7', 'Wellbeing', 'Mine');
  timer.runAll();
  await queue.whenIdle();

  assert.equal(queue.status.get(), 'saved');
  assert.deepEqual(store.live().fields, {
    Wellbeing: 'Mine',
    LineManagerComments: 'Good month.',
  });
  // The second save is judged against what the first left behind, so the
  // queue's own write is never mistaken for somebody else's.
  queue.enqueue('7', 'Wellbeing', 'Mine again');
  timer.runAll();
  await queue.whenIdle();
  assert.equal(queue.status.get(), 'saved');
});

test('the time of the last successful save is known before saved is announced', async () => {
  const store = fieldStore(FORM);
  const at = new Date('2026-10-10T15:32:00Z');
  const { queue, timer } = queueFor(store.target, () => at);
  queue.loadCase(FORM);
  assert.equal(queue.lastSavedAt, null, 'nothing has saved yet');
  /** @type {Array<[string, string | null]>} */
  const seen = [];
  queue.subscribeStatus((status) => seen.push([status, queue.lastSavedAt]));

  queue.enqueue('7', 'Wellbeing', 'Better');
  timer.runAll();
  await queue.whenIdle();

  assert.deepEqual(seen.at(-1), ['saved', at.toISOString()]);
});

test('a conflict does not move the last-saved time', async () => {
  const store = fieldStore(FORM);
  const { queue, timer } = queueFor(store.target, () => new Date());
  queue.loadCase(FORM);
  store.editElsewhere({ Wellbeing: 'Theirs' });

  queue.enqueue('7', 'Wellbeing', 'Mine');
  timer.runAll();
  await queue.whenIdle();

  assert.equal(queue.lastSavedAt, null);
});

test('an item loaded read-only cannot be queued for saving, in either form', () => {
  const store = fieldStore(FORM);
  const { queue } = queueFor(store.target);
  queue.loadCase(FORM, { readOnly: true });

  assert.throws(() => queue.enqueue('7', 'Wellbeing', 'x'), /read-only/);
  assert.throws(
    () => queue.enqueueFields('7', { Wellbeing: 'x' }),
    /read-only/
  );
  assert.equal(queue.status.get(), 'saved', 'a refused write shows no saving');
});

test('loading an item again as editable lifts the read-only refusal', async () => {
  const store = fieldStore(FORM);
  const { queue, timer } = queueFor(store.target);
  queue.loadCase(FORM, { readOnly: true });
  queue.loadCase(FORM);

  queue.enqueue('7', 'Wellbeing', 'Now allowed');
  timer.runAll();
  await queue.whenIdle();
  assert.equal(store.live().fields.Wellbeing, 'Now allowed');
});
