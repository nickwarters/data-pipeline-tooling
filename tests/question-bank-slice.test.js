// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, flush } from './_dom-stub.js';
import { fireEvent, getByRole } from './helpers/semantic-dom.js';

installDom();

const { bankEditorView, createRouteSlice, selectQuestionBankState } =
  await import('../src/pages/question-bank/cora-bank-editor.js');
const { baselineBank, diffCounts, isDirty, questionBankReducer } =
  await import('../src/pages/question-bank/bank-slice.js');
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

test('editing one of 500 questions preserves untouched card identities within the 5 ms gate', () => {
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

  const edited = questionBankReducer(state, {
    type: 'question/field-changed',
    questionId: 'q-250',
    field: 'text',
    value: 'Edited question',
  });
  assert.notEqual(edited.cases.synthetic.questions[250], questions[250]);
  assert.equal(edited.cases.synthetic.questions[249], questions[249]);
  assert.equal(edited.cases.synthetic.questions[251], questions[251]);

  let sampleState = edited;
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
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
  const coverageInstrumented =
    process.env.npm_lifecycle_event === 'test:coverage';
  if (!coverageInstrumented) {
    assert.ok(p95 <= 5, `single-edit p95 took ${p95.toFixed(2)} ms`);
  }
});

test('bank selectors report added, changed, and deprecated Question Definitions', () => {
  const route = selectQuestionBankState(
    createRouteSlice({}, context()).initialState
  );
  const baseline = baselineBank(route);
  const changed = structuredClone(route);
  changed.cases[changed.activeSlug].questions[0].text += ' edited';
  changed.cases[changed.activeSlug].questions[1].deprecated = true;
  changed.cases[changed.activeSlug].questions.push({
    id: 'q-new',
    text: 'New',
    responseType: 'yes-no-na',
    deprecated: false,
  });
  assert.equal(baseline, route.baseline[route.activeSlug]);
  assert.equal(isDirty(route), false);
  assert.equal(isDirty(changed), true);
  assert.deepEqual(diffCounts(changed), {
    added: 1,
    changed: 1,
    deprecated: 1,
  });
});

test('bank route reducer owns filters, samples, toast, revert, and submit state', () => {
  const slice = createRouteSlice({}, context());
  let state = slice.initialState;
  for (const action of [
    { type: 'filters/changed', patch: { category: 'Opening' } },
    { type: 'rail/changed', open: true },
    { type: 'samples/loaded', slug: 'example', cases: [{ id: '1' }] },
    { type: 'toast/changed', message: 'Saved' },
    { type: 'bank/reverted' },
    { type: 'drawer/changed', open: true },
    { type: 'bank/submitted' },
  ]) {
    state = slice.reducer(state, action);
  }
  const route = selectQuestionBankState(state);
  assert.equal(route.filters.category, 'Opening');
  assert.equal(route.railOpen, true);
  assert.deepEqual(route.sampleCases.example, [{ id: '1' }]);
  assert.equal(route.toastMsg, 'Saved');
  assert.equal(route.drawerOpen, false);
  assert.deepEqual(route.baseline, route.cases);
  assert.equal(slice.reducer(state, { type: 'unknown' }), state);
});

test('bank editor pure view wires tabs, drawer, simulation, and toast actions', () => {
  const slice = createRouteSlice({}, context());
  const route = selectQuestionBankState(slice.initialState);
  const dirtyRoute = questionBankReducer(route, {
    type: 'question/field-changed',
    questionId: route.cases[route.activeSlug].questions[0].id,
    field: 'text',
    value: 'Changed',
  });
  dirtyRoute.drawerOpen = true;
  dirtyRoute.toastMsg = 'Ready';
  /** @type {any[]} */
  const actions = [];
  /** @type {any} */ (globalThis).confirm = () => true;
  /** @type {any} */ (globalThis).setTimeout = (
    /** @type {() => void} */ callback
  ) => {
    callback();
    return 1;
  };
  const search = /** @type {any} */ (globalThis).location.search;
  /** @type {any} */ (globalThis).location.search = '?simulate=1';
  try {
    const view = bankEditorView(
      {
        ...slice.initialState,
        routes: { questionBank: dirtyRoute },
      },
      { dispatch: (action) => actions.push(action), memo: createMemo() }
    );
    fireEvent(getByRole(view, 'button', { name: '↺ Revert' }), 'click');
    fireEvent(getByRole(view, 'button', { name: /Compile & Submit/ }), 'click');
    fireEvent(getByRole(view, 'button', { name: 'Copy' }), 'click');
    fireEvent(getByRole(view, 'button', { name: 'Send for Review' }), 'click');
    fireEvent(view.querySelector('.drawer-close'), 'click');
    assert.equal(view.querySelector('.sim-panel')?.className, 'sim-panel');
    assert.equal(view.querySelector('.toast')?.className, 'toast show');
  } finally {
    /** @type {any} */ (globalThis).location.search = search;
  }
  const types = actions.map((action) => action.type);
  assert.ok(types.includes('bank/reverted'));
  assert.ok(types.includes('bank/submitted'));
  assert.ok(types.includes('drawer/changed'));
  assert.ok(types.includes('toast/changed'));
});

test('bank route start owns keyboard, sample-load, and unmount effects', async () => {
  /** @type {string[]} */
  const classes = [];
  /** @type {string[]} */
  const removed = [];
  const ctx = /** @type {any} */ ({
    ...context(),
    appEl: {
      classList: {
        add: (/** @type {string} */ name) => classes.push(name),
        remove: (/** @type {string} */ name) => removed.push(name),
      },
    },
    loadQuestionBankSamples: async () => ({
      example: [{ id: 'case-1', title: 'Case', answers: {} }],
    }),
  });
  const slice = createRouteSlice({}, ctx);
  /** @type {any[]} */
  const actions = [];
  /** @type {Function|null} */
  let key = null;
  const search = /** @type {any} */ (globalThis).location.search;
  /** @type {any} */ (globalThis).location.search = '?simulate=1';
  const dispose = slice.start({
    dispatch: (/** @type {any} */ action) => actions.push(action),
    listen: (
      /** @type {any} */ _target,
      /** @type {string} */ type,
      /** @type {Function} */ listener
    ) => {
      if (type === 'keydown') key = listener;
    },
  });
  /** @type {any} */ (key)({
    metaKey: true,
    key: 'Enter',
    preventDefault() {},
  });
  /** @type {any} */ (key)({ key: 'Escape' });
  await flush();
  dispose();
  /** @type {any} */ (globalThis).location.search = search;

  assert.deepEqual(classes, ['cora-fullbleed']);
  assert.deepEqual(removed, ['cora-fullbleed']);
  assert.ok(actions.some((action) => action.type === 'samples/loaded'));
  assert.ok(actions.some((action) => action.type === 'rail/changed'));
});

test('bank editor and route effects preserve rejected and disabled branches', async () => {
  const slice = createRouteSlice({}, context());
  /** @type {any[]} */
  const actions = [];
  const originalConfirm = /** @type {any} */ (globalThis).confirm;
  const originalTimeout = /** @type {any} */ (globalThis).setTimeout;
  const search = /** @type {any} */ (globalThis).location.search;
  try {
    /** @type {any} */ (globalThis).confirm = () => false;
    /** @type {any} */ (globalThis).setTimeout = undefined;
    const initial = selectQuestionBankState(slice.initialState);
    const dirty = questionBankReducer(initial, {
      type: 'question/field-changed',
      questionId: initial.cases[initial.activeSlug].questions[0].id,
      field: 'text',
      value: 'Changed',
    });
    const view = bankEditorView(
      { ...slice.initialState, routes: { questionBank: dirty } },
      { dispatch: (action) => actions.push(action) }
    );
    fireEvent(getByRole(view, 'button', { name: '↺ Revert' }), 'click');
    assert.equal(
      actions.some((action) => action.type === 'bank/reverted'),
      false
    );

    /** @type {any} */ (globalThis).location.search = '';
    let key = /** @type {Function|null} */ (null);
    slice.start({
      dispatch: (/** @type {any} */ action) => actions.push(action),
      listen: (
        /** @type {any} */ _target,
        /** @type {string} */ _type,
        /** @type {Function} */ listener
      ) => {
        key = listener;
      },
    });
    /** @type {any} */ (key)({ ctrlKey: true, key: 'Enter' });
    /** @type {any} */ (key)({ key: 'Other' });
    await flush();
  } finally {
    /** @type {any} */ (globalThis).confirm = originalConfirm;
    /** @type {any} */ (globalThis).setTimeout = originalTimeout;
    /** @type {any} */ (globalThis).location.search = search;
  }
  assert.ok(actions.some((action) => action.type === 'drawer/changed'));
});
