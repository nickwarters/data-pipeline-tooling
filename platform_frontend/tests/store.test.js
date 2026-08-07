// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/core/store.js';

/** @typedef {{ count: number }} State */
/** @typedef {{ type: string, by?: number }} Action */
/** @type {import('../src/core/store.js').Reducer<State, Action>} */
const reducer = (state, action) =>
  action.type === 'increment'
    ? { count: state.count + (action.by ?? 0) }
    : state;

test('dispatch updates state synchronously and returns it', () => {
  /** @type {Array<() => void>} */
  const callbacks = [];
  const store = createStore({
    initialState: { count: 0 },
    reducer,
    onStateChange() {},
    schedule: (callback) => callbacks.push(callback),
  });
  const state = store.dispatch({ type: 'increment', by: 2 });
  assert.deepEqual(state, { count: 2 });
  assert.equal(store.getState(), state);
  assert.equal(callbacks.length, 1);
});

test('multiple dispatches in one tick schedule exactly one render', () => {
  /** @type {Array<() => void>} */
  const callbacks = [];
  /** @type {number[]} */
  const rendered = [];
  const store = createStore({
    initialState: { count: 0 },
    reducer,
    onStateChange: (state) => rendered.push(state.count),
    schedule: (callback) => callbacks.push(callback),
  });
  store.dispatch({ type: 'increment', by: 1 });
  store.dispatch({ type: 'increment', by: 2 });
  assert.equal(callbacks.length, 1);
  const callback = callbacks.shift();
  assert.ok(callback);
  callback();
  assert.deepEqual(rendered, [3]);
  store.dispatch({ type: 'unknown' });
  assert.equal(callbacks.length, 1);
});

test('flush is immediate and dispose suppresses queued and future notifications', () => {
  /** @type {Array<() => void>} */
  const callbacks = [];
  let renders = 0;
  const store = createStore({
    initialState: { count: 0 },
    reducer,
    onStateChange: () => renders++,
    schedule: (callback) => callbacks.push(callback),
  });
  store.flush();
  store.dispatch({ type: 'increment', by: 1 });
  store.dispose();
  callbacks[0]();
  store.dispatch({ type: 'increment', by: 1 });
  assert.equal(renders, 1);
  assert.deepEqual(store.getState(), { count: 2 });
});

test('default scheduler renders on a microtask', async () => {
  /** @type {number[]} */
  const rendered = [];
  const store = createStore({
    initialState: { count: 0 },
    reducer,
    onStateChange: (state) => rendered.push(state.count),
  });
  store.dispatch({ type: 'increment', by: 1 });
  assert.deepEqual(rendered, []);
  await Promise.resolve();
  assert.deepEqual(rendered, [1]);
});
