// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

const { createRouteSlice, selectQuestionBankState } =
  await import('../src/pages/question-bank/cora-bank-editor.js');
const { BankList } =
  await import('../src/pages/question-bank/cora-bank-list.js');
const { createMemo } = await import('../src/core/memo.js');

function context() {
  return /** @type {any} */ ({
    appEl: { classList: { add() {}, remove() {} } },
    chrome: {
      toasts: [],
      nav: { currentHash: '#/question-bank' },
      currentUser: { id: 'owner-1', displayName: 'Owner' },
      permissions: {},
    },
  });
}

test('question bank slice owns bank selection, filters, and drawer state', () => {
  const slice = createRouteSlice({}, context());
  const initial = selectQuestionBankState(slice.initialState);
  const selected = slice.reducer(slice.initialState, {
    type: 'bank/selected',
    slug: initial.activeSlug,
  });
  const filtered = slice.reducer(selected, {
    type: 'filters/changed',
    patch: { conditionalOnly: true },
  });
  const opened = slice.reducer(filtered, {
    type: 'drawer/changed',
    open: true,
  });

  assert.equal(selectQuestionBankState(opened).filters.conditionalOnly, true);
  assert.equal(selectQuestionBankState(opened).drawerOpen, true);
  assert.equal(selectQuestionBankState(opened).activeSlug, initial.activeSlug);
  assert.notEqual(opened, slice.initialState);
});

test('question bank slice deprecates and restores definitions without deleting them', () => {
  const slice = createRouteSlice({}, context());
  const before = selectQuestionBankState(slice.initialState);
  const question = before.cases[before.activeSlug].questions[0];

  const deprecated = slice.reducer(slice.initialState, {
    type: 'question/deprecation-toggled',
    questionId: question.id,
  });
  const afterDeprecation = selectQuestionBankState(deprecated);
  assert.equal(
    afterDeprecation.cases[before.activeSlug].questions.length,
    before.cases[before.activeSlug].questions.length
  );
  assert.equal(
    afterDeprecation.cases[before.activeSlug].questions[0].deprecated,
    true
  );

  const restored = slice.reducer(deprecated, {
    type: 'question/deprecation-toggled',
    questionId: question.id,
  });
  assert.equal(
    selectQuestionBankState(restored).cases[before.activeSlug].questions[0]
      .deprecated,
    false
  );
});

test('question bank list stays within the 5 ms steady-state gate for 500 memoised questions', () => {
  const questions = Array.from({ length: 500 }, (_, index) => ({
    id: `q-${index}`,
    text: `Question ${index}`,
    responseType: 'yes-no-na',
    deprecated: false,
  }));
  const props = {
    bank: { slug: 'synthetic', label: 'Synthetic', questions },
    baselineQuestions: questions,
    filters: {
      category: null,
      questionGroup: null,
      showDeprecated: true,
      conditionalOnly: false,
    },
    dirty: false,
    onCommit: (/** @type {() => void} */ mutation) => mutation(),
    addQuestion() {},
    memo: createMemo(),
  };
  BankList(props);

  const started = performance.now();
  BankList(props);
  const elapsed = performance.now() - started;

  assert.ok(elapsed <= 5, `steady-state render took ${elapsed.toFixed(2)} ms`);
});
