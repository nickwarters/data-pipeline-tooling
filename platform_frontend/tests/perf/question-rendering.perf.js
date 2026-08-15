// @ts-check
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../_dom-stub.js';

installDom();

const { createRouteSlice } =
  await import('../../src/pages/question-bank/cora-bank-editor.js');
const { questionBankReducer } =
  await import('../../src/pages/question-bank/bank-slice.js');
const { BankList } =
  await import('../../src/pages/question-bank/cora-bank-list.js');
const { createQuestionPanelView } =
  await import('../../src/pages/cora-case-review/question-panel-view.js');
const { createMemo } = await import('../../src/core/memo.js');

function context() {
  return /** @type {any} */ ({
    appEl: { classList: { add() {}, remove() {} } },
    chrome: {
      currentUser: { id: 'owner-1', displayName: 'Owner' },
      permissions: {},
    },
  });
}

/** @typedef {import('../../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/** @param {string} id @param {string} group @returns {QuestionDefinition} */
function question(id, group) {
  return {
    id,
    text: `Question ${id}`,
    questionGroup: group,
    responseType: 'yes-no-na',
    deprecated: false,
  };
}

test('editing one of 500 questions stays cheaper than rebuilding the bank', (t) => {
  const questions = Array.from({ length: 500 }, (_, index) => ({
    id: `q-${index}`,
    text: `Question ${index}`,
    responseType: 'yes-no-na',
    deprecated: false,
  }));
  const state = /** @type {any} */ ({
    ...createRouteSlice({}, context()).initialState.routes.questionBank,
    cases: {
      synthetic: { slug: 'synthetic', label: 'Synthetic', questions },
    },
    baseline: {
      synthetic: {
        slug: 'synthetic',
        label: 'Synthetic',
        questions: structuredClone(questions),
      },
    },
    activeSlug: 'synthetic',
  });
  const memo = createMemo();
  const props = {
    bank: state.cases.synthetic,
    baselineQuestions: state.baseline.synthetic.questions,
    filters: {
      category: null,
      questionGroup: null,
      showDeprecated: true,
      conditionalOnly: false,
    },
    dirty: false,
    dispatch() {},
    addQuestion() {},
    memo,
  };
  BankList(props);

  let sampleState = questionBankReducer(state, {
    type: 'question/field-changed',
    questionId: 'q-250',
    field: 'text',
    value: 'Edited question',
  });

  // The gate is a *ratio*, not a wall-clock budget. What memoisation buys is
  // that a one-question edit rebuilds one card instead of 500, so the honest
  // regression signal is "an edit costs a fraction of a cold render" — and a
  // fraction is the same number on a fast laptop and a loaded CI box. An
  // absolute budget would measure the hardware as much as the code.
  //
  // A cold render — fresh memo, every card built — is the cost of no
  // memoisation at all, i.e. exactly what a regression here would look like.
  const coldSamples = [];
  for (let index = 0; index < 20; index += 1) {
    const coldMemo = createMemo();
    const started = performance.now();
    BankList({ ...props, memo: coldMemo });
    if (index >= 5) coldSamples.push(performance.now() - started);
  }

  const samples = [];
  for (let index = 0; index < 60; index += 1) {
    sampleState = questionBankReducer(sampleState, {
      type: 'question/field-changed',
      questionId: 'q-250',
      field: 'text',
      value: `Edited question ${index}`,
    });
    const started = performance.now();
    BankList({ ...props, bank: sampleState.cases.synthetic });
    if (index >= 10) samples.push(performance.now() - started);
  }

  /** @param {number[]} values */
  const p95 = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.ceil(sorted.length * 0.95) - 1];
  };
  const editP95 = p95(samples);
  const coldP95 = p95(coldSamples);
  const ratio = editP95 / coldP95;
  t.diagnostic(
    `500-question edit p95 ${editP95.toFixed(2)} ms vs cold ${coldP95.toFixed(2)} ms (${(ratio * 100).toFixed(2)}%)`
  );
  // Memoised, an edit measures well under 1% of a cold render; unmemoised it
  // would be ~100%. 10% is therefore two orders of magnitude clear of the
  // observed value and still nowhere near the failure it exists to catch.
  assert.ok(
    ratio <= 0.1,
    `a single edit cost ${(ratio * 100).toFixed(2)}% of a full rebuild (${editP95.toFixed(2)} ms vs ${coldP95.toFixed(2)} ms) — memoisation is not holding`
  );
});

test('answering one of 500 Questions stays cheaper than rebuilding the list', (t) => {
  const catalogue = Array.from({ length: 500 }, (_, index) =>
    question(
      `q-${String(index + 1).padStart(3, '0')}`,
      `Group ${String(Math.floor(index / 25) + 1).padStart(2, '0')}`
    )
  );
  const base = {
    catalogue,
    questions: catalogue,
    answers: {},
    access: /** @type {const} */ ('edit'),
    heading: 'Questions',
    onAnswer() {},
    onGroupOutcome() {},
  };
  const questionsView = createQuestionPanelView();
  questionsView.view(base);
  questionsView.view({ ...base, answers: { 'q-001': { value: 'Yes' } } });

  // The timing half is a *ratio*, not a wall-clock budget. What memoisation
  // buys is that answering one Question rebuilds one card instead of 500, so
  // the honest regression signal is "an answer costs a fraction of a cold
  // render" — and a fraction is the same number on a fast laptop and a loaded
  // CI box. An absolute budget would measure the hardware as much as the code.
  //
  // A cold render — fresh view, fresh memo, every card built — is the cost of
  // no memoisation at all, i.e. exactly what a regression here would look like.
  const coldSamples = [];
  for (let index = 0; index < 20; index += 1) {
    const coldView = createQuestionPanelView();
    const started = performance.now();
    coldView.view(base);
    if (index >= 5) coldSamples.push(performance.now() - started);
  }

  const answerSamples = [];
  for (let index = 0; index < 60; index += 1) {
    const next = {
      ...base,
      answers: { 'q-001': { value: index % 2 ? 'Yes' : 'No' } },
    };
    const started = performance.now();
    questionsView.view(next);
    if (index >= 10) answerSamples.push(performance.now() - started);
  }

  /** @param {number[]} values */
  const median = (values) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const answerMedian = median(answerSamples);
  const coldMedian = median(coldSamples);
  const ratio = answerMedian / coldMedian;
  t.diagnostic(
    `500-question answer median ${answerMedian.toFixed(2)} ms vs cold ${coldMedian.toFixed(2)} ms (${(ratio * 100).toFixed(2)}%)`
  );
  // Memoised, an answer measures 2-3% of a cold render — the residue is the
  // per-render work that is not memoised (group progress, the unanswered
  // filter, the group anchors). With the card memo defeated it measures
  // 87-99%. 20% sits ~7x above the observed value and ~4x below the mildest
  // observed regression, which is about as evenly as the two can be split.
  assert.ok(
    ratio <= 0.2,
    `answering one of 500 Questions cost ${(ratio * 100).toFixed(2)}% of a full rebuild (${answerMedian.toFixed(2)} ms vs ${coldMedian.toFixed(2)} ms) — memoisation is not holding`
  );
});
