// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
installDom();

const { CORACaseTabs, CaseTabs } =
  await import('../src/components/collections/cora-case-tabs.js');
const {
  _resetStore,
  activeSlug,
  cases,
  baseline,
  drawerOpen,
  isDirty,
  toastMsg,
} = await import('../src/question-bank/question-bank-store.js');

test('CaseTabs: plain function renders one tab per case type', () => {
  const nav = CaseTabs({
    types: {
      alpha: { label: 'Alpha', questions: [{ id: 'a' }] },
      beta: { label: 'Beta', questions: [{ id: 'b' }, { id: 'c' }] },
    },
    active: 'beta',
    dirty: false,
    onSelect: () => {},
    onRevert: () => {},
    onCompile: () => {},
  });

  const tabsContainer = /** @type {any} */ (nav)._children[1];
  assert.equal(tabsContainer._children.length, 2);
  assert.equal(tabsContainer._children[1].className, 'case-tab active');
});

test('CORACaseTabs: one tab per case type; clicking switches activeSlug', () => {
  _resetStore();
  const e = new CORACaseTabs();
  e.connectedCallback();
  const nav = /** @type {any} */ (e)._children[0];
  const tabsContainer = nav._children[1];
  assert.equal(tabsContainer._children.length, 4);
  tabsContainer._children[1]._listeners.click[0]();
  assert.equal(activeSlug.get(), 'complaints');
  e.disconnectedCallback();
});

test('CORACaseTabs: Revert with clean state shows "Nothing to revert" toast', () => {
  _resetStore();
  const e = new CORACaseTabs();
  e.connectedCallback();
  const nav = /** @type {any} */ (e)._children[0];
  const right = nav._children[2];
  const revertBtn = right._children[0];
  // Stub setTimeout so showToast doesn't loop
  /** @type {any} */ (globalThis).setTimeout = () => 0;
  revertBtn._listeners.click[0]();
  assert.equal(toastMsg.get(), 'Nothing to revert');
  assert.equal(isDirty.get(), false);
  e.disconnectedCallback();
});

test('CORACaseTabs: Revert with dirty state + confirmed reverts to baseline', () => {
  _resetStore();
  cases.set({
    ...cases.get(),
    'example-review': { ...cases.get()['example-review'], label: 'CHANGED' },
  });
  /** @type {any} */ (globalThis).confirm = () => true;
  /** @type {any} */ (globalThis).setTimeout = () => 0;
  const e = new CORACaseTabs();
  e.connectedCallback();
  const nav = /** @type {any} */ (e)._children[0];
  const right = nav._children[2];
  const revertBtn = right._children[0];
  revertBtn._listeners.click[0]();
  assert.equal(
    cases.get()['example-review'].label,
    baseline.get()['example-review'].label
  );
  e.disconnectedCallback();
});

test('CORACaseTabs: Revert with cancelled confirm is a no-op', () => {
  _resetStore();
  cases.set({
    ...cases.get(),
    'example-review': { ...cases.get()['example-review'], label: 'NEW' },
  });
  /** @type {any} */ (globalThis).confirm = () => false;
  const e = new CORACaseTabs();
  e.connectedCallback();
  const nav = /** @type {any} */ (e)._children[0];
  const right = nav._children[2];
  const revertBtn = right._children[0];
  revertBtn._listeners.click[0]();
  assert.equal(cases.get()['example-review'].label, 'NEW');
  e.disconnectedCallback();
});

test('CORACaseTabs: Compile button opens the drawer', () => {
  _resetStore();
  const e = new CORACaseTabs();
  e.connectedCallback();
  const nav = /** @type {any} */ (e)._children[0];
  const right = nav._children[2];
  const compileBtn = right._children[1];
  compileBtn._listeners.click[0]();
  assert.equal(drawerOpen.get(), true);
  e.disconnectedCallback();
});
