// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCommandPaletteState,
  createCommandPaletteStore,
  filterActions,
} from '../src/services/command-palette-store.js';

/** @param {string} id @param {Record<string, any>} [overrides] */
function action(id, overrides = {}) {
  return {
    id,
    label: `Action ${id}`,
    keywords: [],
    handler() {},
    ...overrides,
  };
}

test('command palette store: register adds and duplicate ids replace actions', () => {
  const store = createCommandPaletteStore();
  store.dispatch({ type: 'palette/register', action: action('open') });
  store.dispatch({
    type: 'palette/register',
    action: action('open', { label: 'Open Case' }),
  });
  assert.deepEqual(
    store.getState().actions.map((item) => item.label),
    ['Open Case']
  );
});

test('command palette store: deregister removes only the named action', () => {
  const store = createCommandPaletteStore();
  for (const id of ['a', 'b']) {
    store.dispatch({ type: 'palette/register', action: action(id) });
  }
  store.dispatch({ type: 'palette/deregister', id: 'a' });
  assert.deepEqual(
    store.getState().actions.map((item) => item.id),
    ['b']
  );
});

test('command palette store: close resets transient interaction state', () => {
  const store = createCommandPaletteStore({
    ...createCommandPaletteState(),
    isOpen: true,
    query: 'case',
    selectedIndex: 2,
  });
  store.dispatch({ type: 'palette/close' });
  assert.deepEqual(store.getState(), createCommandPaletteState());
});

test('command palette store: dispatch synchronously notifies subscribers', () => {
  const store = createCommandPaletteStore();
  /** @type {boolean[]} */
  const seen = [];
  const unsubscribe = store.subscribe((state) => seen.push(state.isOpen));
  store.dispatch({ type: 'palette/open' });
  unsubscribe();
  store.dispatch({ type: 'palette/close' });
  assert.deepEqual(seen, [true]);
});

test('filterActions matches labels and keywords case-insensitively', () => {
  const actions = [
    action('case', { label: 'Go to Case' }),
    action('allocate', { keywords: ['Assign'] }),
  ];
  assert.deepEqual(
    filterActions('CASE', actions).map((item) => item.id),
    ['case']
  );
  assert.deepEqual(
    filterActions('assign', actions).map((item) => item.id),
    ['allocate']
  );
});
