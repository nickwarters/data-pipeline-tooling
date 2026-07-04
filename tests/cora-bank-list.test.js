// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
installDom();

const { CORABankList } = await import('../src/question-bank/cora-bank-list.js');
const { _resetStore, cases, activeSlug, filters } =
  await import('../src/question-bank/question-bank-store.js');

test('CORABankList: renders dirty pill + question cards + add button', () => {
  _resetStore();
  const e = new CORABankList();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  // editor-head, outcome-options, listRoot, add-card
  assert.equal(section._children.length, 4);
  // example-review fixture has 5 questions; with default filters all visible
  const listRoot = section._children[2];
  assert.equal(listRoot._children.length, 5);
  e.disconnectedCallback();
});

test('CORABankList: empty-state when no question passes filters', () => {
  _resetStore();
  // showDeprecated off + a slug whose questions are all deprecated
  filters.set({
    category: null,
    showDeprecated: false,
    conditionalOnly: false,
  });
  cases.set({
    'example-review': {
      label: 'L',
      slug: 'example-review',
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
  const e = new CORABankList();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const listRoot = section._children[2];
  assert.equal(listRoot._children[0].className, 'empty');
  e.disconnectedCallback();
});

test('CORABankList: category filter hides non-matching questions', () => {
  _resetStore();
  filters.set({
    category: 'Opening',
    showDeprecated: true,
    conditionalOnly: false,
  });
  const e = new CORABankList();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const listRoot = section._children[2];
  // Only q-welcome is in 'Opening'
  assert.equal(listRoot._children.length, 1);
  e.disconnectedCallback();
});

test('CORABankList: conditionalOnly hides unconditional questions', () => {
  _resetStore();
  filters.set({ category: null, showDeprecated: true, conditionalOnly: true });
  const e = new CORABankList();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const listRoot = section._children[2];
  // Only q-resolve has showWhen in example-review
  assert.equal(listRoot._children.length, 1);
  e.disconnectedCallback();
});

test('CORABankList: + Draft a new question appends a draft', () => {
  _resetStore();
  activeSlug.set('example-review');
  const before = cases.get()['example-review'].questions.length;
  const e = new CORABankList();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const addBtn = section._children[3];
  addBtn._listeners.click[0]();
  assert.equal(cases.get()['example-review'].questions.length, before + 1);
  e.disconnectedCallback();
});

test('CORABankList: + Draft falls back to immediate scroll when no rAF', () => {
  _resetStore();
  activeSlug.set('example-review');
  const saved = /** @type {any} */ (globalThis).requestAnimationFrame;
  /** @type {any} */ (globalThis).requestAnimationFrame = undefined;
  const e = new CORABankList();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const addBtn = section._children[3];
  addBtn._listeners.click[0](); // exercises the else branch
  /** @type {any} */ (globalThis).requestAnimationFrame = saved;
  e.disconnectedCallback();
});

test('CORABankList: dirty pill reflects isDirty', () => {
  _resetStore();
  const e = new CORABankList();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const head = section._children[0];
  const dirty = head._children[1];
  // Initially clean
  assert.equal(dirty.className, 'dirty-indicator');
  e.disconnectedCallback();
});

test('CORABankList: bank label and slug render as text, not HTML', () => {
  _resetStore();
  activeSlug.set('example-review');
  cases.set({
    'example-review': {
      label: '<img src=x onerror=alert(1)>',
      slug: '<script>alert(1)</script>',
      eligibleGroups: [],
      questions: [],
    },
  });

  const e = new CORABankList();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const heading = section._children[0]._children[0];
  const label = heading._children[0];
  const meta = heading._children[1];

  assert.equal(label.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(
    meta.textContent,
    '0 questions · slug: <script>alert(1)</script>'
  );
  assert.equal(heading.innerHTML, '');
  e.disconnectedCallback();
});
