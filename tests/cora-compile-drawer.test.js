// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
installDom();

const { CORACompileDrawer } =
  await import('../src/components/collections/cora-compile-drawer.js');
const { _resetStore, drawerOpen, baseline, cases, toastMsg, commit } =
  await import('../src/question-bank/question-bank-store.js');

/** @type {any} */ (globalThis).setTimeout = () => 0;

test('CORACompileDrawer: renders backdrop + drawer (closed by default)', () => {
  _resetStore();
  drawerOpen.set(false);
  const e = new CORACompileDrawer();
  e.connectedCallback();
  const kids = /** @type {any} */ (e)._children;
  assert.equal(kids.length, 2);
  assert.ok(!kids[0].className.includes('open'));
  e.disconnectedCallback();
});

test('CORACompileDrawer: open state adds .open to backdrop and drawer', () => {
  _resetStore();
  drawerOpen.set(true);
  const e = new CORACompileDrawer();
  e.connectedCallback();
  const kids = /** @type {any} */ (e)._children;
  assert.ok(kids[0].className.includes('open'));
  assert.ok(kids[1].className.includes('open'));
  e.disconnectedCallback();
});

test('CORACompileDrawer: backdrop click closes drawer', () => {
  _resetStore();
  drawerOpen.set(true);
  const e = new CORACompileDrawer();
  e.connectedCallback();
  const backdrop = /** @type {any} */ (e)._children[0];
  backdrop._listeners.click[0]();
  assert.equal(drawerOpen.get(), false);
  e.disconnectedCallback();
});

test('CORACompileDrawer: close × button closes drawer', () => {
  _resetStore();
  drawerOpen.set(true);
  const e = new CORACompileDrawer();
  e.connectedCallback();
  const drawer = /** @type {any} */ (e)._children[1];
  const head = drawer._children[0];
  const closeBtn = head._children[1];
  closeBtn._listeners.click[0]();
  assert.equal(drawerOpen.get(), false);
  e.disconnectedCallback();
});

test('CORACompileDrawer: Copy writes code to clipboard + shows toast', async () => {
  _resetStore();
  drawerOpen.set(true);
  /** @type {any} */
  let written = null;
  try {
    /** @type {any} */ (globalThis).navigator = {
      clipboard: {
        writeText: async (/** @type {string} */ s) => {
          written = s;
        },
      },
    };
  } catch {
    /* read-only navigator on some runtimes */
  }
  const e = new CORACompileDrawer();
  e.connectedCallback();
  const drawer = /** @type {any} */ (e)._children[1];
  const foot = drawer._children[2];
  const copyBtn = foot._children[1]._children[0];
  await copyBtn._listeners.click[0]();
  assert.equal(toastMsg.get(), 'Config copied to clipboard');
  e.disconnectedCallback();
});

test('CORACompileDrawer: Send for Review snapshots baseline + closes', () => {
  _resetStore();
  drawerOpen.set(true);
  commit((t) => {
    t['example-review'].label = 'AFTER';
  });
  const e = new CORACompileDrawer();
  e.connectedCallback();
  const drawer = /** @type {any} */ (e)._children[1];
  const foot = drawer._children[2];
  const sendBtn = foot._children[1]._children[1];
  sendBtn._listeners.click[0]();
  assert.equal(baseline.get()['example-review'].label, 'AFTER');
  assert.equal(drawerOpen.get(), false);
  assert.equal(toastMsg.get(), 'Submitted for review');
  e.disconnectedCallback();
});

test('CORACompileDrawer: Send bakes Always questions (clears showWhen) and drops showWhenMode', () => {
  _resetStore();
  commit((t) => {
    t['example-review'].questions = [
      {
        id: 'q-always',
        text: 'A',
        responseType: 'yes-no-na',
        showWhen: { q0: { equals: 'Yes' } },
        showWhenMode: 'always',
        deprecated: false,
      },
      {
        id: 'q-cond',
        text: 'C',
        responseType: 'yes-no-na',
        showWhen: { q0: { equals: 'Yes' } },
        showWhenMode: 'conditional',
        deprecated: false,
      },
    ];
  });
  drawerOpen.set(true);
  const e = new CORACompileDrawer();
  e.connectedCallback();
  const drawer = /** @type {any} */ (e)._children[1];
  const sendBtn = drawer._children[2]._children[1]._children[1];
  sendBtn._listeners.click[0]();

  const qs = cases.get()['example-review'].questions;
  // Always question: conditions cleared for good, intent field dropped
  assert.equal('showWhen' in qs[0], false);
  assert.equal('showWhenMode' in qs[0], false);
  // Conditional question: conditions kept, intent field still dropped
  assert.deepEqual(qs[1].showWhen, { q0: { equals: 'Yes' } });
  assert.equal('showWhenMode' in qs[1], false);
  e.disconnectedCallback();
});

test('CORACompileDrawer: diff cards render added / changed / removed counts', () => {
  _resetStore();
  commit((t) => {
    t['example-review'].questions.push({
      id: 'new',
      text: '',
      responseType: 'yes-no-na',
      deprecated: false,
    });
  });
  drawerOpen.set(true);
  const e = new CORACompileDrawer();
  e.connectedCallback();
  const drawer = /** @type {any} */ (e)._children[1];
  const body = drawer._children[1];
  const diffSummary = body._children[0];
  assert.equal(diffSummary._children.length, 3);
  e.disconnectedCallback();
});

test('CORACompileDrawer: code preview uses explicit highlighted HTML that escapes question text', () => {
  _resetStore();
  cases.set({
    'example-review': {
      label: 'Example',
      slug: 'example-review',
      eligibleGroups: [],
      questions: [
        {
          id: 'q-danger',
          text: '<img src=x onerror=alert(1)>',
          responseType: 'yes-no-na',
          deprecated: false,
        },
      ],
    },
  });
  drawerOpen.set(true);
  const e = new CORACompileDrawer();
  e.connectedCallback();
  const drawer = /** @type {any} */ (e)._children[1];
  const body = drawer._children[1];
  const codeBlock = body._children[1];

  assert.ok(codeBlock.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!codeBlock.innerHTML.includes('<img src=x'));
  assert.equal(codeBlock._children.length, 0);
  e.disconnectedCallback();
});
