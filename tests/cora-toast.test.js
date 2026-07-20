// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();
const { Toast } = await import('../src/components/base/cora-toast.js');
const { createToastStore } = await import('../src/lib/toast.js');

test('Toast: hidden and visible display are pure functions of message state', () => {
  const hidden = /** @type {any} */ (Toast({ message: '' }));
  assert.equal(hidden.className, 'toast');

  const visible = /** @type {any} */ (Toast({ message: 'Saved' }));
  assert.equal(visible.className, 'toast show');
  assert.equal(visible.textContent, 'Saved');
});

test('toast store: show actions notify display subscribers', () => {
  const store = createToastStore();
  /** @type {string[]} */
  const messages = [];
  store.subscribe((state) => messages.push(state.message));
  store.dispatch({ type: 'toast/show', message: 'Saved' });
  assert.equal(store.getState().message, 'Saved');
  assert.deepEqual(messages, ['Saved']);
});

test('toast store: stale clear actions do not erase a newer message', () => {
  const store = createToastStore();
  store.dispatch({ type: 'toast/show', message: 'First' });
  store.dispatch({ type: 'toast/show', message: 'Second' });
  store.dispatch({ type: 'toast/clear', message: 'First' });
  assert.equal(store.getState().message, 'Second');
  store.dispatch({ type: 'toast/clear', message: 'Second' });
  assert.equal(store.getState().message, '');
});
