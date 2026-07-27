// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();
const { Toast } = await import('../src/components/base/cora-toast.js');

test('Toast: hidden and visible display are pure functions of message state', () => {
  const hidden = /** @type {any} */ (Toast({ message: '' }));
  assert.equal(hidden.className, 'toast');

  const visible = /** @type {any} */ (Toast({ message: 'Saved' }));
  assert.equal(visible.className, 'toast show');
  assert.equal(visible.textContent, 'Saved');
});
