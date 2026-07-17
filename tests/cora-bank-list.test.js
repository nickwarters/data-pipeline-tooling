// @ts-check
import { resetStoreWithExampleReview } from './_bank-store-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  getByTag,
  queryAllByTag,
} from './helpers/semantic-dom.js';
installDom();

const { CORABankList } =
  await import('../src/pages/question-bank/cora-bank-list.js');
const { _resetStore, cases, activeSlug, filters } =
  await import('../src/pages/question-bank/question-bank-store.js');

test('CORABankList: renders dirty pill + question cards + add button', () => {
  resetStoreWithExampleReview();
  const e = new CORABankList();
  e.connectedCallback();
  assert.ok(e.querySelector('.editor-head'));
  assert.ok(getByTag(e, 'cora-outcome-options-editor'));
  assert.ok(getByRole(e, 'button', { name: /Draft a new question/ }));
  // With default filters all live example-review questions are visible.
  assert.equal(
    queryAllByTag(e, 'cora-question-card').length,
    cases.get()['example-review'].questions.length
  );
  e.disconnectedCallback();
});

test('CORABankList: empty-state when no question passes filters', () => {
  resetStoreWithExampleReview();
  // showDeprecated off + a slug whose questions are all deprecated
  filters.set({
    category: null,
    questionGroup: null,
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
  const empty = e.querySelector('.empty');
  assert.ok(empty);
  assert.equal(empty.className, 'empty');
  assert.equal(queryAllByTag(e, 'cora-question-card').length, 0);
  e.disconnectedCallback();
});

test('CORABankList: Question Group filter hides non-matching questions', () => {
  resetStoreWithExampleReview();
  filters.set({
    category: null,
    questionGroup: 'Opening',
    showDeprecated: true,
    conditionalOnly: false,
  });
  const e = new CORABankList();
  e.connectedCallback();
  // Only q-welcome is in 'Opening'
  assert.equal(queryAllByTag(e, 'cora-question-card').length, 1);
  e.disconnectedCallback();
});

test('CORABankList: conditionalOnly hides unconditional questions', () => {
  resetStoreWithExampleReview();
  filters.set({
    category: null,
    questionGroup: null,
    showDeprecated: true,
    conditionalOnly: true,
  });
  const e = new CORABankList();
  e.connectedCallback();
  // Only q-resolve has showWhen in example-review
  assert.equal(queryAllByTag(e, 'cora-question-card').length, 1);
  e.disconnectedCallback();
});

test('CORABankList: + Draft a new question appends a draft', () => {
  resetStoreWithExampleReview();
  activeSlug.set('example-review');
  const before = cases.get()['example-review'].questions.length;
  const e = new CORABankList();
  e.connectedCallback();
  fireEvent(getByRole(e, 'button', { name: /Draft a new question/ }), 'click');
  assert.equal(cases.get()['example-review'].questions.length, before + 1);
  e.disconnectedCallback();
});

test('CORABankList: + Draft falls back to immediate scroll when no rAF', () => {
  resetStoreWithExampleReview();
  activeSlug.set('example-review');
  const saved = /** @type {any} */ (globalThis).requestAnimationFrame;
  /** @type {any} */ (globalThis).requestAnimationFrame = undefined;
  const e = new CORABankList();
  e.connectedCallback();
  fireEvent(getByRole(e, 'button', { name: /Draft a new question/ }), 'click');
  /** @type {any} */ (globalThis).requestAnimationFrame = saved;
  e.disconnectedCallback();
});

test('CORABankList: dirty pill reflects isDirty', () => {
  resetStoreWithExampleReview();
  const e = new CORABankList();
  e.connectedCallback();
  const dirty = e.querySelector('.dirty-indicator');
  assert.ok(dirty);
  // Initially clean
  assert.equal(dirty.className, 'dirty-indicator');
  e.disconnectedCallback();
});

test('CORABankList: bank label and slug render as text, not HTML', () => {
  resetStoreWithExampleReview();
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
  const heading = getByTag(e, 'h2');
  const label = queryAllByTag(heading, 'span')[0];
  const meta = heading.querySelector('.meta');

  assert.equal(label.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(
    meta.textContent,
    '0 questions · slug: <script>alert(1)</script>'
  );
  assert.equal(heading.innerHTML, '');
  e.disconnectedCallback();
});
