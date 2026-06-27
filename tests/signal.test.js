import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal, computed, effect } from '../src/lib/signal.js';

// --- signal ---

test('signal: get returns initial value', () => {
  const s = signal(42);
  assert.equal(s.get(), 42);
});

test('signal: set updates value', () => {
  const s = signal(1);
  s.set(99);
  assert.equal(s.get(), 99);
});

test('signal: multiple independent subscribers all receive update', () => {
  const s = signal(0);
  /** @type {number[]} */
  const received = [];
  effect(() => received.push(s.get()));
  effect(() => received.push(s.get() * 10));
  s.set(5);
  // Each effect ran once on creation (0, 0) then once on set (5, 50)
  assert.deepEqual(received, [0, 0, 5, 50]);
});

// --- computed ---

test('computed: derives value from signal', () => {
  const s = signal(3);
  const doubled = computed(() => s.get() * 2);
  assert.equal(doubled.get(), 6);
});

test('computed: updates when dependency changes', () => {
  const s = signal(1);
  const c = computed(() => s.get() + 10);
  assert.equal(c.get(), 11);
  s.set(5);
  assert.equal(c.get(), 15);
});

test('computed: is not re-evaluated when dependency has not changed', () => {
  let evalCount = 0;
  const s = signal(7);
  const c = computed(() => {
    evalCount++;
    return s.get() * 2;
  });
  c.get(); // first eval
  c.get(); // should be cached
  assert.equal(evalCount, 1);
  s.set(8);
  c.get(); // stale — re-eval
  assert.equal(evalCount, 2);
  c.get(); // cached again
  assert.equal(evalCount, 2);
});

test('computed: chains multiple signals', () => {
  const a = signal(2);
  const b = signal(3);
  const sum = computed(() => a.get() + b.get());
  assert.equal(sum.get(), 5);
  a.set(10);
  assert.equal(sum.get(), 13);
  b.set(1);
  assert.equal(sum.get(), 11);
});

test('computed: re-run tracks only the signals read on the latest evaluation', () => {
  const useLeft = signal(true);
  const left = signal(1);
  const right = signal(10);
  let evalCount = 0;
  const chosen = computed(() => {
    evalCount++;
    return useLeft.get() ? left.get() : right.get();
  });

  assert.equal(chosen.get(), 1);
  useLeft.set(false);
  assert.equal(chosen.get(), 10);

  left.set(2);
  assert.equal(chosen.get(), 10);
  assert.equal(evalCount, 2);

  right.set(20);
  assert.equal(chosen.get(), 20);
  assert.equal(evalCount, 3);
});

// --- effect ---

test('effect: runs immediately on creation', () => {
  const s = signal('hello');
  let last = null;
  effect(() => {
    last = s.get();
  });
  assert.equal(last, 'hello');
});

test('effect: re-runs synchronously when dependency changes', () => {
  const s = signal(0);
  /** @type {number[]} */
  const log = [];
  effect(() => log.push(s.get()));
  s.set(1);
  s.set(2);
  assert.deepEqual(log, [0, 1, 2]);
});

test('effect: dispose stops future runs', () => {
  const s = signal(0);
  /** @type {number[]} */
  const log = [];
  const dispose = effect(() => log.push(s.get()));
  s.set(1);
  dispose();
  s.set(2);
  s.set(3);
  assert.deepEqual(log, [0, 1]);
});

test('effect: returns a dispose function', () => {
  const s = signal(0);
  const dispose = effect(() => s.get());
  assert.equal(typeof dispose, 'function');
});

test('effect: disposed effect does not re-subscribe on signal change', () => {
  const s = signal(0);
  let runCount = 0;
  const dispose = effect(() => {
    runCount++;
    s.get();
  });
  dispose();
  s.set(1);
  assert.equal(runCount, 1); // only the initial run
});

test('effect: re-run unsubscribes from signals that are no longer read', () => {
  const useLeft = signal(true);
  const left = signal(1);
  const right = signal(10);
  /** @type {number[]} */
  const log = [];

  effect(() => {
    log.push(useLeft.get() ? left.get() : right.get());
  });

  useLeft.set(false);
  left.set(2);
  right.set(20);

  assert.deepEqual(log, [1, 10, 20]);
});

test('effect: dispose removes subscriptions from computed dependents', () => {
  const s = signal(1);
  let evalCount = 0;
  const doubled = computed(() => {
    evalCount++;
    return s.get() * 2;
  });
  /** @type {number[]} */
  const log = [];

  const dispose = effect(() => log.push(doubled.get()));
  dispose();
  s.set(2);

  assert.deepEqual(log, [2]);
  assert.equal(evalCount, 1);
});
