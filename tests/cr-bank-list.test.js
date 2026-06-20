// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_bank-dom-stub.js';
installDom();

const { CRBankList } = await import('../src/question-bank/cr-bank-list.js');
const { _resetStore, cases, activeSlug, filters } =
  await import('../src/question-bank/question-bank-store.js');

test('CRBankList: renders dirty pill + question cards + add button', () => {
  _resetStore();
  const e = new CRBankList();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  // editor-head, listRoot, add-card
  assert.equal(section._children.length, 3);
  // hello-review fixture has 5 questions; with default filters all visible
  const listRoot = section._children[1];
  assert.equal(listRoot._children.length, 5);
  e.disconnectedCallback();
});

test('CRBankList: empty-state when no question passes filters', () => {
  _resetStore();
  // showDeprecated off + a slug whose questions are all deprecated
  filters.set({
    category: null,
    showDeprecated: false,
    conditionalOnly: false,
  });
  cases.set({
    'hello-review': {
      label: 'L',
      slug: 'hello-review',
      eligibleGroups: [],
      questions: [
        /** @type {any} */ ({
          id: 'd',
          text: 'd',
          responseType: 'yes-no-na',
          deprecated: true,
        }),
      ],
    },
  });
  const e = new CRBankList();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const listRoot = section._children[1];
  assert.equal(listRoot._children[0].className, 'empty');
  e.disconnectedCallback();
});

test('CRBankList: category filter hides non-matching questions', () => {
  _resetStore();
  filters.set({
    category: 'Opening',
    showDeprecated: true,
    conditionalOnly: false,
  });
  const e = new CRBankList();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const listRoot = section._children[1];
  // Only q-welcome is in 'Opening'
  assert.equal(listRoot._children.length, 1);
  e.disconnectedCallback();
});

test('CRBankList: conditionalOnly hides unconditional questions', () => {
  _resetStore();
  filters.set({ category: null, showDeprecated: true, conditionalOnly: true });
  const e = new CRBankList();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const listRoot = section._children[1];
  // Only q-resolve has showWhen in hello-review
  assert.equal(listRoot._children.length, 1);
  e.disconnectedCallback();
});

test('CRBankList: + Draft a new question appends a draft', () => {
  _resetStore();
  activeSlug.set('hello-review');
  const before = cases.get()['hello-review'].questions.length;
  const e = new CRBankList();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const addBtn = section._children[2];
  addBtn._listeners.click[0]();
  assert.equal(cases.get()['hello-review'].questions.length, before + 1);
  e.disconnectedCallback();
});

test('CRBankList: + Draft falls back to immediate scroll when no rAF', () => {
  _resetStore();
  activeSlug.set('hello-review');
  const saved = /** @type {any} */ (globalThis).requestAnimationFrame;
  /** @type {any} */ (globalThis).requestAnimationFrame = undefined;
  const e = new CRBankList();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const addBtn = section._children[2];
  addBtn._listeners.click[0](); // exercises the else branch
  /** @type {any} */ (globalThis).requestAnimationFrame = saved;
  e.disconnectedCallback();
});

test('CRBankList: dirty pill reflects isDirty', () => {
  _resetStore();
  const e = new CRBankList();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const head = section._children[0];
  const dirty = head._children[1];
  // Initially clean
  assert.equal(dirty.className, 'dirty-indicator');
  e.disconnectedCallback();
});
