// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
installDom();

const { CORAToast } = await import('../src/components/base/cora-toast.js');
const { toastMsg } = await import('../src/lib/toast.js');

test('CORAToast: hidden by default (no msg → no "show" class)', () => {
  toastMsg.set('');
  const t = new CORAToast();
  t.connectedCallback();
  const inner = /** @type {any} */ (t)._children[0];
  assert.equal(inner.className, 'toast');
});

test('CORAToast: shows when toastMsg is non-empty', () => {
  toastMsg.set('Hello');
  const t = new CORAToast();
  t.connectedCallback();
  const inner = /** @type {any} */ (t)._children[0];
  assert.equal(inner.className, 'toast show');
  assert.equal(inner._children[1].textContent, 'Hello');
  t.disconnectedCallback();
});

test('CORAToast: reacts to toastMsg change', () => {
  toastMsg.set('');
  const t = new CORAToast();
  t.connectedCallback();
  toastMsg.set('Saved');
  const inner = /** @type {any} */ (t)._children[0];
  assert.equal(inner.className, 'toast show');
  t.disconnectedCallback();
});
