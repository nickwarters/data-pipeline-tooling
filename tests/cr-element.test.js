// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '../src/lib/signal.js';

// Provide a minimal HTMLElement stub before cr-element.js is evaluated.
// Cast through any to satisfy tsc (DOM lib types HTMLElement as non-writable on globalThis).
(/** @type {any} */ (globalThis)).HTMLElement = class {
  disconnectedCallback() {}
};

const { CRElement } = await import('../src/components/cr-element.js');

test('CRElement: subscribe fires immediately with the current signal value', () => {
  const el = new CRElement();
  const s = signal(42);
  /** @type {number[]} */
  const received = [];

  el.subscribe(s, (v) => received.push(v));
  assert.deepEqual(received, [42]);
});

test('CRElement: subscribe fires on every subsequent signal change', () => {
  const el = new CRElement();
  const s = signal(0);
  /** @type {number[]} */
  const received = [];

  el.subscribe(s, (v) => received.push(v));
  s.set(1);
  s.set(2);
  assert.deepEqual(received, [0, 1, 2]);
});

test('CRElement: disconnectedCallback disposes subscriptions — no more callbacks fire', () => {
  const el = new CRElement();
  const s = signal('a');
  /** @type {string[]} */
  const received = [];

  el.subscribe(s, (v) => received.push(v));
  s.set('b');
  el.disconnectedCallback();
  s.set('c');
  s.set('d');
  assert.deepEqual(received, ['a', 'b']);
});

test('CRElement: all subscriptions are disposed on disconnect', () => {
  const el = new CRElement();
  const s1 = signal(1);
  const s2 = signal(10);
  /** @type {string[]} */
  const log = [];

  el.subscribe(s1, (v) => log.push(`s1:${v}`));
  el.subscribe(s2, (v) => log.push(`s2:${v}`));

  el.disconnectedCallback();
  s1.set(99);
  s2.set(99);

  assert.deepEqual(log, ['s1:1', 's2:10']);
});

test('CRElement: reconnecting after disconnect starts fresh — new subscriptions work', () => {
  const el = new CRElement();
  const s = signal(0);
  /** @type {number[]} */
  const log = [];

  el.subscribe(s, (v) => log.push(v));
  s.set(1);
  el.disconnectedCallback();

  // Simulate reconnect — call subscribe again (as connectedCallback would)
  el.subscribe(s, (v) => log.push(v));
  s.set(2);
  el.disconnectedCallback();
  s.set(3); // should not fire — disposed

  // Second subscribe fires immediately with s's current value (1), then s.set(2) → 2.
  assert.deepEqual(log, [0, 1, 1, 2]);
});
