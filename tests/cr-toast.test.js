// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
installDom();

const { CRToast } = await import('../src/components/cr-toast.js');
const { toastMsg } =
  await import('../src/question-bank/question-bank-store.js');

test('CRToast: hidden by default (no msg → no "show" class)', () => {
  toastMsg.set('');
  const t = new CRToast();
  t.connectedCallback();
  const inner = /** @type {any} */ (t)._children[0];
  assert.equal(inner.className, 'toast');
});

test('CRToast: shows when toastMsg is non-empty', () => {
  toastMsg.set('Hello');
  const t = new CRToast();
  t.connectedCallback();
  const inner = /** @type {any} */ (t)._children[0];
  assert.equal(inner.className, 'toast show');
  assert.equal(inner._children[1].textContent, 'Hello');
  t.disconnectedCallback();
});

test('CRToast: reacts to toastMsg change', () => {
  toastMsg.set('');
  const t = new CRToast();
  t.connectedCallback();
  toastMsg.set('Saved');
  const inner = /** @type {any} */ (t)._children[0];
  assert.equal(inner.className, 'toast show');
  t.disconnectedCallback();
});
