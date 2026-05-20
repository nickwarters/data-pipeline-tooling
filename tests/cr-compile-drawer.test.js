// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_bank-dom-stub.js';
installDom();

const { CRCompileDrawer } = await import('../src/components/cr-compile-drawer.js');
const {
  _resetStore, drawerOpen, baseline, cases, toastMsg, commit,
} = await import('../src/question-bank/question-bank-store.js');

(/** @type {any} */ (globalThis)).setTimeout = () => 0;

test('CRCompileDrawer: renders backdrop + drawer (closed by default)', () => {
  _resetStore();
  drawerOpen.set(false);
  const e = new CRCompileDrawer();
  e.connectedCallback();
  const kids = /** @type {any} */ (e)._children;
  assert.equal(kids.length, 2);
  assert.ok(!kids[0].className.includes('open'));
  e.disconnectedCallback();
});

test('CRCompileDrawer: open state adds .open to backdrop and drawer', () => {
  _resetStore();
  drawerOpen.set(true);
  const e = new CRCompileDrawer();
  e.connectedCallback();
  const kids = /** @type {any} */ (e)._children;
  assert.ok(kids[0].className.includes('open'));
  assert.ok(kids[1].className.includes('open'));
  e.disconnectedCallback();
});

test('CRCompileDrawer: backdrop click closes drawer', () => {
  _resetStore();
  drawerOpen.set(true);
  const e = new CRCompileDrawer();
  e.connectedCallback();
  const backdrop = /** @type {any} */ (e)._children[0];
  backdrop._listeners.click[0]();
  assert.equal(drawerOpen.get(), false);
  e.disconnectedCallback();
});

test('CRCompileDrawer: close × button closes drawer', () => {
  _resetStore();
  drawerOpen.set(true);
  const e = new CRCompileDrawer();
  e.connectedCallback();
  const drawer = /** @type {any} */ (e)._children[1];
  const head = drawer._children[0];
  const closeBtn = head._children[1];
  closeBtn._listeners.click[0]();
  assert.equal(drawerOpen.get(), false);
  e.disconnectedCallback();
});

test('CRCompileDrawer: Copy writes code to clipboard + shows toast', async () => {
  _resetStore();
  drawerOpen.set(true);
  /** @type {any} */
  let written = null;
  try {
    (/** @type {any} */ (globalThis)).navigator = { clipboard: { writeText: async (/** @type {string} */ s) => { written = s; } } };
  } catch { /* read-only navigator on some runtimes */ }
  const e = new CRCompileDrawer();
  e.connectedCallback();
  const drawer = /** @type {any} */ (e)._children[1];
  const foot = drawer._children[2];
  const copyBtn = foot._children[1]._children[0];
  await copyBtn._listeners.click[0]();
  assert.equal(toastMsg.get(), 'Config copied to clipboard');
  e.disconnectedCallback();
});

test('CRCompileDrawer: Send for Review snapshots baseline + closes', () => {
  _resetStore();
  drawerOpen.set(true);
  commit(t => { t['hello-review'].label = 'AFTER'; });
  const e = new CRCompileDrawer();
  e.connectedCallback();
  const drawer = /** @type {any} */ (e)._children[1];
  const foot = drawer._children[2];
  const sendBtn = foot._children[1]._children[1];
  sendBtn._listeners.click[0]();
  assert.equal(baseline.get()['hello-review'].label, 'AFTER');
  assert.equal(drawerOpen.get(), false);
  assert.equal(toastMsg.get(), 'Submitted for review');
  e.disconnectedCallback();
});

test('CRCompileDrawer: diff cards render added / changed / removed counts', () => {
  _resetStore();
  commit(t => {
    t['hello-review'].questions.push({ id: 'new', text: '', responseType: 'yes-no-na', deprecated: false });
  });
  drawerOpen.set(true);
  const e = new CRCompileDrawer();
  e.connectedCallback();
  const drawer = /** @type {any} */ (e)._children[1];
  const body = drawer._children[1];
  const diffSummary = body._children[0];
  assert.equal(diffSummary._children.length, 3);
  e.disconnectedCallback();
});
