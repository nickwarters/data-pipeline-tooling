// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_bank-dom-stub.js';
installDom();

const { CRCaseTabs } = await import('../src/components/cr-case-tabs.js');
const {
  _resetStore, activeSlug, cases, baseline, drawerOpen, isDirty, toastMsg,
} = await import('../src/question-bank/question-bank-store.js');

test('CRCaseTabs: one tab per case type; clicking switches activeSlug', () => {
  _resetStore();
  const e = new CRCaseTabs();
  e.connectedCallback();
  const nav = /** @type {any} */ (e)._children[0];
  const tabsContainer = nav._children[1];
  assert.equal(tabsContainer._children.length, 2);  // hello-review + complaint-review
  tabsContainer._children[1]._listeners.click[0]();
  assert.equal(activeSlug.get(), 'complaint-review');
  e.disconnectedCallback();
});

test('CRCaseTabs: Revert with clean state shows "Nothing to revert" toast', () => {
  _resetStore();
  const e = new CRCaseTabs();
  e.connectedCallback();
  const nav = /** @type {any} */ (e)._children[0];
  const right = nav._children[2];
  const revertBtn = right._children[0];
  // Stub setTimeout so showToast doesn't loop
  (/** @type {any} */ (globalThis)).setTimeout = () => 0;
  revertBtn._listeners.click[0]();
  assert.equal(toastMsg.get(), 'Nothing to revert');
  assert.equal(isDirty.get(), false);
  e.disconnectedCallback();
});

test('CRCaseTabs: Revert with dirty state + confirmed reverts to baseline', () => {
  _resetStore();
  cases.set({
    ...cases.get(),
    'hello-review': { ...cases.get()['hello-review'], label: 'CHANGED' },
  });
  (/** @type {any} */ (globalThis)).confirm = () => true;
  (/** @type {any} */ (globalThis)).setTimeout = () => 0;
  const e = new CRCaseTabs();
  e.connectedCallback();
  const nav = /** @type {any} */ (e)._children[0];
  const right = nav._children[2];
  const revertBtn = right._children[0];
  revertBtn._listeners.click[0]();
  assert.equal(cases.get()['hello-review'].label, baseline.get()['hello-review'].label);
  e.disconnectedCallback();
});

test('CRCaseTabs: Revert with cancelled confirm is a no-op', () => {
  _resetStore();
  cases.set({
    ...cases.get(),
    'hello-review': { ...cases.get()['hello-review'], label: 'NEW' },
  });
  (/** @type {any} */ (globalThis)).confirm = () => false;
  const e = new CRCaseTabs();
  e.connectedCallback();
  const nav = /** @type {any} */ (e)._children[0];
  const right = nav._children[2];
  const revertBtn = right._children[0];
  revertBtn._listeners.click[0]();
  assert.equal(cases.get()['hello-review'].label, 'NEW');
  e.disconnectedCallback();
});

test('CRCaseTabs: Compile button opens the drawer', () => {
  _resetStore();
  const e = new CRCaseTabs();
  e.connectedCallback();
  const nav = /** @type {any} */ (e)._children[0];
  const right = nav._children[2];
  const compileBtn = right._children[1];
  compileBtn._listeners.click[0]();
  assert.equal(drawerOpen.get(), true);
  e.disconnectedCallback();
});
