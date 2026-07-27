// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, flush } from './_dom-stub.js';
import { fireEvent, getByRole, queryByRole } from './helpers/semantic-dom.js';

installDom();

const { bankEditorView, createRouteSlice, selectQuestionBankState } =
  await import('../src/pages/question-bank/cora-bank-editor.js');
const { baselineBank, currentBank, diffCounts, isDirty, questionBankReducer } =
  await import('../src/pages/question-bank/bank-slice.js');
const { BankList } =
  await import('../src/pages/question-bank/cora-bank-list.js');
const { createMemo } = await import('../src/core/memo.js');
const { loadQuestionBanks } =
  await import('../src/pages/question-bank/question-bank-source.js');

const { banks: liveBanks } = await loadQuestionBanks();

/**
 * The banks now arrive through `start()` rather than at import (#521). Tests
 * that assert on a populated editor seat them up front, and inject the loader
 * so `start()` does no real I/O.
 * @param {any} [ctx]
 * @returns {any}
 */
function loadedSlice(ctx = context()) {
  const slice = createRouteSlice({}, ctx, {
    loadBanks: async () => ({ banks: liveBanks, failures: [] }),
  });
  return {
    ...slice,
    initialState: slice.reducer(slice.initialState, {
      type: 'bank/loaded',
      banks: liveBanks,
      failures: [],
    }),
  };
}

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
  const slice = loadedSlice();
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
  const slice = loadedSlice();
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

test('editing one of 500 questions rebuilds one card, not the bank', (t) => {
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

  // The gate is a *ratio*, not a wall-clock budget. What memoisation buys is
  // that a one-question edit rebuilds one card instead of 500, so the honest
  // regression signal is "an edit costs a fraction of a cold render" — and a
  // fraction is the same number on a fast laptop and a loaded CI box. The
  // absolute 5 ms budget this replaced measured the hardware as much as the
  // code: it left ~6x headroom on a quiet machine and went red on a busy one,
  // which made the middle of a stacked branch series a coin toss.
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

test('editing a Question ID refreshes condition targets in memoised neighbouring cards', () => {
  const questions = [
    {
      id: 'source-question',
      text: 'Source',
      responseType: 'yes-no-na',
      deprecated: false,
    },
    {
      id: 'conditional-question',
      text: 'Conditional',
      responseType: 'yes-no-na',
      deprecated: false,
      showWhen: { 'source-question': { equals: 'Yes' } },
    },
  ];
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
    questionId: 'source-question',
    field: 'id',
    value: 'renamed-source',
  });
  const rerendered = BankList({
    ...props,
    bank: edited.cases.synthetic,
  });
  const conditionTarget = /** @type {HTMLSelectElement} */ (
    rerendered.querySelector('[aria-label="Condition question"]')
  );

  assert.equal(
    /** @type {HTMLOptionElement} */ (conditionTarget.childNodes[0]).value,
    'renamed-source'
  );
});

test('bank selectors report added, changed, and deprecated Question Definitions', () => {
  const route = selectQuestionBankState(loadedSlice().initialState);
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

test('bank route reducer owns filters, samples, toast, revert, and publish state', () => {
  const slice = loadedSlice();
  let state = slice.initialState;
  for (const action of [
    { type: 'filters/changed', patch: { category: 'Opening' } },
    { type: 'rail/changed', open: true },
    { type: 'samples/loaded', slug: 'example', cases: [{ id: '1' }] },
    { type: 'toast/changed', message: 'Saved' },
    { type: 'bank/reverted' },
    { type: 'drawer/changed', open: true },
    { type: 'publish/requested' },
    { type: 'publish/succeeded', artifacts: { currentJson: '{}' } },
    { type: 'publish/failed', message: 'write failed' },
  ]) {
    state = slice.reducer(state, action);
  }
  const route = selectQuestionBankState(state);
  assert.equal(route.filters.category, 'Opening');
  assert.equal(route.railOpen, true);
  assert.deepEqual(route.sampleCases.example, [{ id: '1' }]);
  assert.equal(route.toastMsg, 'Publish failed');
  assert.equal(route.drawerOpen, false);
  assert.deepEqual(route.baseline, route.cases);
  assert.equal(route.publishStatus, 'failed');
  assert.equal(route.publishError, 'write failed');
  assert.equal(slice.reducer(state, { type: 'unknown' }), state);
});

test('bank editor pure view wires tabs, drawer, simulation, and toast actions', () => {
  const slice = loadedSlice();
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
  assert.ok(types.includes('publish/requested'));
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
  const slice = loadedSlice(ctx);
  /** @type {any[]} */
  const actions = [];
  /** @type {Function|null} */
  let key = null;
  const search = /** @type {any} */ (globalThis).location.search;
  /** @type {any} */ (globalThis).location.search = '?simulate=1';
  const dispose = slice.start({
    dispatch: (/** @type {any} */ action) => actions.push(action),
    isActive: () => true,
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

test('Send for Review runs the publish effect and stores its exact artifacts', async () => {
  /** @type {any[]} */
  const writes = [];
  /** @type {(value?: unknown) => void} */
  let wrote = () => {};
  const written = new Promise((resolve) => {
    wrote = resolve;
  });
  const slice = loadedSlice(
    /** @type {any} */ ({
      ...context(),
      writeQuestionBankArtifacts: async (/** @type {any} */ artifacts) => {
        writes.push(artifacts);
        wrote();
      },
    })
  );
  let state = slice.reducer(slice.initialState, {
    type: 'drawer/changed',
    open: true,
  });
  let active = true;
  const tools = /** @type {any} */ ({
    dispatch(/** @type {any} */ action) {
      state = slice.reducer(state, action);
    },
    listen() {},
    isActive: () => active,
  });
  const view = slice.view(state, tools);
  const dispose = slice.start(tools);
  fireEvent(getByRole(view, 'button', { name: 'Send for Review' }), 'click');
  await written;
  await flush();
  dispose();

  assert.equal(writes.length, 1);
  const route = selectQuestionBankState(state);
  assert.equal(route.publishStatus, 'succeeded');
  assert.equal(route.publishArtifacts, writes[0]);
  assert.equal(route.drawerOpen, false);
  assert.deepEqual(route.baseline, route.cases);
});

test('publish effect reports writer failures and ignores work after unmount', async () => {
  for (const reason of [new Error('write failed'), 'string failure']) {
    let attempted = /** @type {(value?: unknown) => void} */ (() => {});
    const attempt = new Promise((resolve) => {
      attempted = resolve;
    });
    const slice = loadedSlice(
      /** @type {any} */ ({
        ...context(),
        writeQuestionBankArtifacts: async () => {
          attempted();
          throw reason;
        },
      })
    );
    let state = slice.reducer(slice.initialState, {
      type: 'drawer/changed',
      open: true,
    });
    let active = true;
    const tools = /** @type {any} */ ({
      dispatch(/** @type {any} */ action) {
        state = slice.reducer(state, action);
      },
      listen() {},
      isActive: () => active,
    });
    const view = slice.view(state, tools);
    const dispose = slice.start(tools);
    fireEvent(getByRole(view, 'button', { name: 'Send for Review' }), 'click');
    await attempt;
    await flush();
    assert.equal(selectQuestionBankState(state).publishStatus, 'failed');
    dispose();
  }

  let release = /** @type {(value?: unknown) => void} */ (() => {});
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const slice = loadedSlice(
    /** @type {any} */ ({
      ...context(),
      writeQuestionBankArtifacts: async () => pending,
    })
  );
  let state = slice.reducer(slice.initialState, {
    type: 'drawer/changed',
    open: true,
  });
  let active = true;
  const tools = /** @type {any} */ ({
    dispatch(/** @type {any} */ action) {
      state = slice.reducer(state, action);
    },
    listen() {},
    isActive: () => active,
  });
  const view = slice.view(state, tools);
  fireEvent(getByRole(view, 'button', { name: 'Send for Review' }), 'click');
  assert.equal(selectQuestionBankState(state).publishStatus, 'idle');
  const dispose = slice.start(tools);
  const activeView = slice.view(state, tools);
  fireEvent(
    getByRole(activeView, 'button', { name: 'Send for Review' }),
    'click'
  );
  active = false;
  dispose();
  release();
  await flush();
  assert.equal(selectQuestionBankState(state).publishStatus, 'publishing');
});

test('bank editor and route effects preserve rejected and disabled branches', async () => {
  const slice = loadedSlice();
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
      isActive: () => true,
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

  /** @type {any} */ (globalThis).location.search = '?simulate=1';
  const invalidSamples = loadedSlice(
    /** @type {any} */ ({
      ...context(),
      loadQuestionBankSamples: async () => null,
    })
  );
  const dispose = invalidSamples.start({
    dispatch() {},
    isActive: () => true,
    listen() {},
  });
  await flush();
  dispose();
  /** @type {any} */ (globalThis).location.search = search;
});

test('#517 bank editor slice: the adapter mount lifetime, not a page latch, suppresses a late publish', async () => {
  /**
   * Start a publish that the test releases by hand, keeping the page's own
   * `start()` teardown out of it so only the adapter's lifetime is under test.
   */
  const startPublish = () => {
    let release = /** @type {(value?: unknown) => void} */ (() => {});
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    // Resolved once the effect has finished its async compile and reached the
    // writer, so the test never has to guess when the hash is done.
    let reachedWriter = /** @type {(value?: unknown) => void} */ (() => {});
    const atWriter = new Promise((resolve) => {
      reachedWriter = resolve;
    });
    const slice = loadedSlice(
      /** @type {any} */ ({
        ...context(),
        writeQuestionBankArtifacts: async () => {
          reachedWriter();
          await pending;
        },
      })
    );
    let state = slice.reducer(slice.initialState, {
      type: 'drawer/changed',
      open: true,
    });
    let active = true;
    const tools = /** @type {any} */ ({
      dispatch(/** @type {any} */ action) {
        state = slice.reducer(state, action);
      },
      listen() {},
      isActive: () => active,
    });
    slice.start(tools);
    const view = slice.view(state, tools);
    fireEvent(getByRole(view, 'button', { name: 'Send for Review' }), 'click');
    assert.equal(selectQuestionBankState(state).publishStatus, 'publishing');
    return {
      atWriter,
      release,
      unmount: () => {
        active = false;
      },
      get status() {
        return selectQuestionBankState(state).publishStatus;
      },
    };
  };

  const mounted = startPublish();
  const unmounted = startPublish();
  await Promise.all([mounted.atWriter, unmounted.atWriter]);
  unmounted.unmount();
  mounted.release();
  unmounted.release();
  // Microtasks only, from a point the effect has demonstrably reached: the
  // still-mounted control below fails if this drain is ever too short.
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();

  assert.equal(mounted.status, 'succeeded');
  assert.equal(unmounted.status, 'publishing');
});

/**
 * A store harness over the real slice: `start()` drives it exactly as the
 * adapter would, so the load effect is exercised end to end (#521).
 * @param {any} deps
 * @param {any} [ctx]
 */
function mountSlice(deps, ctx = context()) {
  const slice = createRouteSlice({}, ctx, deps);
  let state = slice.initialState;
  let active = true;
  const tools = /** @type {any} */ ({
    dispatch(/** @type {any} */ action) {
      // Returning the next state is part of the store's contract
      // (`createStore().dispatch`), and the retry effect reads state back at
      // dispatch time through it.
      state = slice.reducer(state, action);
      return state;
    },
    listen() {},
    isActive: () => active,
  });
  const dispose = slice.start(tools);
  return {
    dispatch: tools.dispatch,
    get route() {
      return selectQuestionBankState(state);
    },
    view: () => slice.view(state, { ...tools, memo: createMemo() }),
    unmount: () => {
      active = false;
      dispose?.();
    },
  };
}

// The "no I/O at import" half of #521 cannot be proved from inside this
// process: a module-scope load would run the real QUESTION_BANK_IMPORTERS,
// which the fake importer below never sees, so its counter would stay 0 either
// way. tests/question-bank-import-io-contract.test.js proves it in a child
// process with the real primitives counted; this test owns the other half —
// start() performs exactly one load, through the injected seam.
test('#521 start() performs the single bank load, through the injected importers', async () => {
  let calls = 0;
  const importers = {
    alpha: async () => {
      calls += 1;
      return {
        default: {
          slug: 'alpha',
          label: 'Alpha',
          questions: [
            {
              id: 'q-a',
              text: 'A?',
              responseType: 'yes-no-na',
              deprecated: false,
            },
          ],
        },
      };
    },
  };
  const mounted = mountSlice({
    loadBanks: (/** @type {any} */ _unused) =>
      loadQuestionBanks(/** @type {any} */ (importers)),
  });
  assert.equal(mounted.route.loading, true);
  assert.equal(mounted.route.activeSlug, '');
  await flush();
  await flush();

  assert.equal(calls, 1);
  assert.equal(mounted.route.loading, false);
  assert.equal(mounted.route.activeSlug, 'alpha');
  assert.equal(mounted.route.cases.alpha.questions.length, 1);
  mounted.unmount();
});

test('#521 the bank editor renders a loading state before its banks arrive', async () => {
  let release = /** @type {(value?: any) => void} */ (() => {});
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const mounted = mountSlice({ loadBanks: () => pending });

  const loadingView = mounted.view();
  assert.match(loadingView.textContent ?? '', /Loading Question Banks/);

  release({ banks: liveBanks, failures: [] });
  await flush();
  assert.equal(mounted.route.loading, false);
  assert.doesNotMatch(
    mounted.view().textContent ?? '',
    /Loading Question Banks/
  );
  mounted.unmount();
});

test('#521 a bank load that resolves after unmount is discarded', async () => {
  let release = /** @type {(value?: any) => void} */ (() => {});
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const mounted = mountSlice({ loadBanks: () => pending });
  mounted.unmount();
  release({ banks: liveBanks, failures: [] });
  await flush();

  assert.equal(mounted.route.loading, true);
  assert.deepEqual(mounted.route.cases, {});
});

test('#521 a failed bank load leaves the editor with an error state, not a blank page', async () => {
  const errors = [];
  const originalError = console.error;
  console.error = (/** @type {any[]} */ ...args) => errors.push(args);
  let mounted;
  try {
    mounted = mountSlice({
      loadBanks: async () => {
        throw new Error('bank artifacts unreachable');
      },
    });
    await flush();
  } finally {
    console.error = originalError;
  }

  assert.equal(mounted.route.loading, false);
  assert.equal(mounted.route.loadError, 'bank artifacts unreachable');
  const text = mounted.view().textContent ?? '';
  assert.match(text, /No Question Bank could be loaded/);
  assert.match(text, /bank artifacts unreachable/);
  assert.equal(errors.length, 1);
  mounted.unmount();
});

test('#521 a load that reports no banks at all still renders the error shell', async () => {
  const mounted = mountSlice({
    loadBanks: async () => ({ banks: {}, failures: [] }),
  });
  await flush();

  assert.match(
    mounted.view().textContent ?? '',
    /No Question Bank artifacts are registered/
  );
  mounted.unmount();
});

test('#521 one unloadable bank still names itself while the others stay editable', async () => {
  const mounted = mountSlice({
    loadBanks: async () => ({
      banks: liveBanks,
      failures: [{ slug: 'broken', message: '404' }],
    }),
  });
  await flush();

  const text = mounted.view().textContent ?? '';
  assert.match(text, /Some Question Banks could not be loaded: broken \(404\)/);
  assert.equal(mounted.route.activeSlug, Object.keys(liveBanks)[0]);
  mounted.unmount();
});

test('#521 the loaded draft and baseline are separate clones, so diffing still sees edits', async () => {
  const mounted = mountSlice({
    loadBanks: async () => ({ banks: liveBanks, failures: [] }),
  });
  await flush();
  const route = mounted.route;

  assert.notEqual(route.cases, route.baseline);
  assert.equal(isDirty(route), false);
  const edited = questionBankReducer(route, {
    type: 'question/field-changed',
    questionId: route.cases[route.activeSlug].questions[0].id,
    field: 'text',
    value: 'Changed by the curator',
  });
  assert.equal(isDirty(edited), true);
  assert.deepEqual(diffCounts(edited), { added: 0, changed: 1, deprecated: 0 });
  assert.notEqual(
    baselineBank(edited).questions[0].text,
    'Changed by the curator'
  );
  // The live bank map handed to the slice is never mutated by editing.
  assert.notEqual(
    liveBanks[route.activeSlug].questions[0].text,
    'Changed by the curator'
  );
  mounted.unmount();
});

test('#521 a sample load that resolves after unmount is discarded', async () => {
  let release = /** @type {(value?: any) => void} */ (() => {});
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const search = /** @type {any} */ (globalThis).location.search;
  /** @type {any} */ (globalThis).location.search = '?simulate=1';
  let mounted;
  try {
    mounted = mountSlice(
      { loadBanks: async () => ({ banks: liveBanks, failures: [] }) },
      /** @type {any} */ ({
        ...context(),
        loadQuestionBankSamples: () => pending,
      })
    );
    await flush();
    mounted.unmount();
    release({ example: [{ id: 'case-1', title: 'Case', answers: {} }] });
    await flush();
  } finally {
    /** @type {any} */ (globalThis).location.search = search;
  }

  assert.deepEqual(mounted.route.sampleCases, {});
});

/**
 * #550 — a minimal two-question bank, so a refresh can change the baseline
 * text without dragging the live artifacts in.
 * @param {string} slug
 * @param {string} text
 * @returns {any}
 */
function syntheticBank(slug, text) {
  return {
    slug,
    label: slug,
    questions: [
      { id: `${slug}-q1`, text, responseType: 'yes-no-na', deprecated: false },
    ],
  };
}

/** @returns {any} */
function emptyRoute() {
  return createRouteSlice({}, context()).initialState.routes.questionBank;
}

test('#550 the initial load seats both halves and selects the first bank', () => {
  const banks = {
    alpha: syntheticBank('alpha', 'A?'),
    beta: syntheticBank('beta', 'B?'),
  };
  const loaded = questionBankReducer(emptyRoute(), {
    type: 'bank/loaded',
    banks,
    failures: [],
  });

  assert.equal(loaded.activeSlug, 'alpha');
  assert.equal(loaded.loading, false);
  assert.deepEqual(Object.keys(loaded.cases), ['alpha', 'beta']);
  assert.deepEqual(loaded.cases, loaded.baseline);
  assert.notEqual(loaded.cases, loaded.baseline);
  assert.notEqual(loaded.cases.alpha, loaded.baseline.alpha);
  assert.notEqual(loaded.cases.alpha, banks.alpha);
  assert.equal(isDirty(loaded), false);
});

test('#550 a refresh keeps the curator draft and lets the diff show the divergence', () => {
  const loaded = questionBankReducer(emptyRoute(), {
    type: 'bank/loaded',
    banks: {
      alpha: syntheticBank('alpha', 'A?'),
      beta: syntheticBank('beta', 'B?'),
    },
    failures: [],
  });
  const edited = questionBankReducer(loaded, {
    type: 'question/field-changed',
    questionId: 'alpha-q1',
    field: 'text',
    value: 'Edited by the curator',
  });
  assert.equal(isDirty(edited), true);

  const incoming = {
    alpha: syntheticBank('alpha', 'A? (republished)'),
    beta: syntheticBank('beta', 'B? (republished)'),
  };
  const refreshed = questionBankReducer(edited, {
    type: 'bank/refreshed',
    banks: incoming,
    failures: [],
  });

  // The edited bank keeps the draft; the untouched one takes the new content.
  assert.equal(
    refreshed.cases.alpha.questions[0].text,
    'Edited by the curator'
  );
  assert.equal(refreshed.cases.beta.questions[0].text, 'B? (republished)');
  // The baseline always moves to the freshly loaded artifacts.
  assert.equal(refreshed.baseline.alpha.questions[0].text, 'A? (republished)');
  assert.equal(refreshed.baseline.beta.questions[0].text, 'B? (republished)');
  // The divergence stays visible rather than silently vanishing.
  assert.equal(isDirty(refreshed), true);
  assert.equal(diffCounts(refreshed).changed, 1);
  // Neither the retained draft nor the replaced one aliases the baseline.
  assert.notEqual(refreshed.cases, refreshed.baseline);
  assert.notEqual(refreshed.cases.alpha, refreshed.baseline.alpha);
  assert.notEqual(refreshed.cases.beta, refreshed.baseline.beta);
  // Nor does either half alias the caller's own artifacts.
  assert.notEqual(refreshed.cases.beta, incoming.beta);
  assert.notEqual(refreshed.baseline.beta, incoming.beta);
  assert.notEqual(refreshed.baseline.alpha, incoming.alpha);

  // Editing the retained draft must not write through to the baseline it is
  // now diffed against.
  const editedAgain = questionBankReducer(refreshed, {
    type: 'question/field-changed',
    questionId: 'alpha-q1',
    field: 'text',
    value: 'Edited after refresh',
  });
  assert.equal(
    editedAgain.baseline.alpha.questions[0].text,
    'A? (republished)'
  );

  // Nor may editing the replaced draft write through to it.
  const replacedEdited = questionBankReducer(
    questionBankReducer(refreshed, { type: 'bank/selected', slug: 'beta' }),
    {
      type: 'question/field-changed',
      questionId: 'beta-q1',
      field: 'text',
      value: 'Edited after refresh',
    }
  );
  assert.equal(
    replacedEdited.cases.beta.questions[0].text,
    'Edited after refresh'
  );
  assert.equal(
    replacedEdited.baseline.beta.questions[0].text,
    'B? (republished)'
  );
});

test('#550 a partial refresh keeps an edited draft for a slug it omits', () => {
  const loaded = questionBankReducer(emptyRoute(), {
    type: 'bank/loaded',
    banks: {
      alpha: syntheticBank('alpha', 'A?'),
      beta: syntheticBank('beta', 'B?'),
    },
    failures: [],
  });
  const edited = questionBankReducer(
    questionBankReducer(loaded, { type: 'bank/selected', slug: 'beta' }),
    {
      type: 'question/field-changed',
      questionId: 'beta-q1',
      field: 'text',
      value: 'PRECIOUS UNSAVED WORK',
    }
  );
  assert.equal(edited.cases.beta.questions[0].text, 'PRECIOUS UNSAVED WORK');

  // A #549 retry resolves with only the artifact that had failed.
  const refreshed = questionBankReducer(edited, {
    type: 'bank/refreshed',
    banks: { alpha: syntheticBank('alpha', 'A? (retried)') },
    failures: [],
  });

  assert.equal(refreshed.cases.beta.questions[0].text, 'PRECIOUS UNSAVED WORK');
  assert.equal(isDirty(refreshed), true);
  // The omitted slug has no baseline left; the diff reads the draft as added.
  assert.equal(Object.hasOwn(refreshed.baseline, 'beta'), false);
  assert.equal(diffCounts(refreshed).added, 1);
  // The carried draft is its own object, shared with nothing in the baseline.
  assert.notEqual(refreshed.cases, refreshed.baseline);
  assert.notEqual(refreshed.cases.beta, refreshed.baseline.beta);
  assert.notEqual(refreshed.cases.beta, refreshed.baseline.alpha);

  // The selection follows the loaded slug set even though the draft survives.
  assert.equal(refreshed.activeSlug, 'alpha');

  // Editing the carried draft must not write through to any baseline bank.
  const again = questionBankReducer(
    questionBankReducer(refreshed, { type: 'bank/selected', slug: 'beta' }),
    {
      type: 'question/field-changed',
      questionId: 'beta-q1',
      field: 'text',
      value: 'Edited after the partial refresh',
    }
  );
  assert.equal(
    again.cases.beta.questions[0].text,
    'Edited after the partial refresh'
  );
  assert.equal(again.baseline.alpha.questions[0].text, 'A? (retried)');
  assert.equal(Object.hasOwn(again.baseline, 'beta'), false);
  assert.equal(
    edited.cases.beta.questions[0].text,
    'PRECIOUS UNSAVED WORK',
    'the pre-refresh state is not mutated'
  );

  // A second partial refresh still carries the now baseline-less draft.
  const twice = questionBankReducer(refreshed, {
    type: 'bank/refreshed',
    banks: { alpha: syntheticBank('alpha', 'A? (retried twice)') },
    failures: [],
  });
  assert.equal(twice.cases.beta.questions[0].text, 'PRECIOUS UNSAVED WORK');

  // An omitted slug with no local edit is still dropped.
  const unedited = questionBankReducer(loaded, {
    type: 'bank/refreshed',
    banks: { alpha: syntheticBank('alpha', 'A? (retried)') },
    failures: [],
  });
  assert.deepEqual(Object.keys(unedited.cases), ['alpha']);
});

test('#550 an inherited key is not a bank, so the selection does not survive', () => {
  const loaded = questionBankReducer(emptyRoute(), {
    type: 'bank/loaded',
    banks: { alpha: syntheticBank('alpha', 'A?') },
    failures: [],
  });
  const dangling = { ...loaded, activeSlug: 'constructor' };

  const refreshed = questionBankReducer(dangling, {
    type: 'bank/refreshed',
    banks: { gamma: syntheticBank('gamma', 'G?') },
    failures: [],
  });
  assert.equal(refreshed.activeSlug, 'gamma');
  assert.notEqual(currentBank(refreshed), undefined);

  const reloaded = questionBankReducer(dangling, {
    type: 'bank/loaded',
    banks: { gamma: syntheticBank('gamma', 'G?') },
    failures: [],
  });
  assert.equal(reloaded.activeSlug, 'gamma');
});

test('#550 an inherited name is not a draft, so a refresh seats the loaded bank', () => {
  // Hand-built and deliberately desynchronised: `cases` has no own `toString`,
  // while `baseline` does. A prototype-chain read of `state.cases.toString`
  // finds `Object.prototype.toString` and, differing from that baseline, would
  // be mistaken for a curator edit and seated as the draft — putting a function
  // where a Question Bank belongs.
  const state = /** @type {any} */ ({
    ...emptyRoute(),
    cases: { alpha: syntheticBank('alpha', 'A?') },
    baseline: {
      alpha: syntheticBank('alpha', 'A?'),
      toString: syntheticBank('toString', 'T?'),
    },
    activeSlug: 'alpha',
  });

  const refreshed = questionBankReducer(state, {
    type: 'bank/refreshed',
    banks: {
      alpha: syntheticBank('alpha', 'A?'),
      toString: syntheticBank('toString', 'T? (loaded)'),
    },
    failures: [],
  });

  const seated = Object.getOwnPropertyDescriptor(
    refreshed.cases,
    'toString'
  )?.value;
  assert.equal(typeof seated, 'object');
  assert.equal(seated.questions[0].text, 'T? (loaded)');
  assert.notEqual(
    seated,
    Object.getOwnPropertyDescriptor(refreshed.baseline, 'toString')?.value
  );
});

test('#550 a refresh that drops the active slug reselects an available bank', () => {
  const loaded = questionBankReducer(emptyRoute(), {
    type: 'bank/loaded',
    banks: { alpha: syntheticBank('alpha', 'A?') },
    failures: [],
  });
  assert.equal(loaded.activeSlug, 'alpha');

  const refreshed = questionBankReducer(loaded, {
    type: 'bank/refreshed',
    banks: { gamma: syntheticBank('gamma', 'G?') },
    failures: [],
  });

  assert.equal(refreshed.activeSlug, 'gamma');
  assert.deepEqual(Object.keys(refreshed.cases), ['gamma']);
  assert.deepEqual(Object.keys(refreshed.baseline), ['gamma']);
  assert.notEqual(currentBank(refreshed), undefined);

  // Nothing left to select at all still degrades to the empty selection.
  const emptied = questionBankReducer(refreshed, {
    type: 'bank/refreshed',
    banks: {},
    failures: [],
  });
  assert.equal(emptied.activeSlug, '');
});

test('#550 a second bank/loaded also reselects rather than dangling', () => {
  const loaded = questionBankReducer(emptyRoute(), {
    type: 'bank/loaded',
    banks: { alpha: syntheticBank('alpha', 'A?') },
    failures: [],
  });
  const again = questionBankReducer(loaded, {
    type: 'bank/loaded',
    banks: { gamma: syntheticBank('gamma', 'G?') },
    failures: [],
  });

  assert.equal(again.activeSlug, 'gamma');
  assert.notEqual(currentBank(again), undefined);
  assert.notEqual(again.cases, again.baseline);
  assert.notEqual(again.cases.gamma, again.baseline.gamma);
});

/**
 * #549 — a two-bank workbench where `beta` fails its initial load, so the
 * failure banner (and its Retry) is on screen. The fake loader records the
 * `only` argument of every call, which is what "re-fetches only the failed
 * slugs" is actually about.
 * @param {(call: number) => any} respond called with the 1-based call number
 * @returns {{ calls: any[], loadBanks: (importers: any, only?: string[]) => Promise<any> }}
 */
function recordingLoader(respond) {
  /** @type {any[]} */
  const calls = [];
  return {
    calls,
    loadBanks: async (/** @type {any} */ _importers, only) => {
      calls.push(only);
      return respond(calls.length);
    },
  };
}

/** One failed bank out of two, the shape every #549 test starts from. */
function partiallyLoaded() {
  return {
    banks: { alpha: syntheticBank('alpha', 'A?') },
    failures: [{ slug: 'beta', message: '404' }],
  };
}

/** @param {any} mounted */
function clickRetry(mounted) {
  fireEvent(getByRole(mounted.view(), 'button', { name: /Retry/ }), 'click');
}

test('#549 a retry re-fetches only the failed slugs and seats the recovered bank', async () => {
  const loader = recordingLoader((call) =>
    call === 1
      ? partiallyLoaded()
      : { banks: { beta: syntheticBank('beta', 'B?') }, failures: [] }
  );
  const mounted = mountSlice({ loadBanks: loader.loadBanks });
  await flush();
  assert.match(
    mounted.view().textContent ?? '',
    /Some Question Banks could not be loaded: beta \(404\)/
  );

  clickRetry(mounted);
  await flush();
  await flush();

  // The whole point: the retry asked for the failed slug and nothing else.
  assert.deepEqual(loader.calls, [undefined, ['beta']]);
  assert.deepEqual(Object.keys(mounted.route.cases), ['alpha', 'beta']);
  assert.deepEqual(Object.keys(mounted.route.baseline), ['alpha', 'beta']);
  assert.equal(mounted.route.cases.beta.questions[0].text, 'B?');
  // The bank that had loaded is still there, and still current.
  assert.equal(mounted.route.cases.alpha.questions[0].text, 'A?');
  assert.deepEqual(mounted.route.loadFailures, []);
  assert.equal(mounted.route.retrying, false);
  assert.equal(isDirty(mounted.route), false);
  // Draft and baseline stay separate objects on every bank, or the diff and the
  // impact simulation silently go empty.
  assert.notEqual(mounted.route.cases, mounted.route.baseline);
  assert.notEqual(mounted.route.cases.alpha, mounted.route.baseline.alpha);
  assert.notEqual(mounted.route.cases.beta, mounted.route.baseline.beta);
  const text = mounted.view().textContent ?? '';
  assert.doesNotMatch(text, /could not be loaded/);
  mounted.unmount();
});

test('#549 a retry cannot discard an in-progress draft', async () => {
  const loader = recordingLoader((call) =>
    call === 1
      ? partiallyLoaded()
      : { banks: { beta: syntheticBank('beta', 'B?') }, failures: [] }
  );
  const mounted = mountSlice({ loadBanks: loader.loadBanks });
  await flush();
  mounted.dispatch({
    type: 'question/field-changed',
    questionId: 'alpha-q1',
    field: 'text',
    value: 'PRECIOUS UNSAVED WORK',
  });
  assert.equal(isDirty(mounted.route), true);

  clickRetry(mounted);
  await flush();
  await flush();

  assert.equal(
    mounted.route.cases.alpha.questions[0].text,
    'PRECIOUS UNSAVED WORK'
  );
  assert.equal(isDirty(mounted.route), true);
  // The draft is still diffable: its baseline survived the retry untouched, so
  // the edit reads as one change rather than as a whole added bank.
  assert.equal(mounted.route.baseline.alpha.questions[0].text, 'A?');
  assert.deepEqual(diffCounts(mounted.route), {
    added: 0,
    changed: 1,
    deprecated: 0,
  });
  assert.equal(mounted.route.cases.beta.questions[0].text, 'B?');
  assert.notEqual(mounted.route.cases.alpha, mounted.route.baseline.alpha);
  assert.notEqual(mounted.route.cases.beta, mounted.route.baseline.beta);
  mounted.unmount();
});

test('#549 a retry that fails again leaves the curator no worse off', async () => {
  const loader = recordingLoader((call) =>
    call === 1
      ? partiallyLoaded()
      : {
          banks: {},
          failures: [{ slug: 'beta', message: `503 (attempt ${call})` }],
        }
  );
  const mounted = mountSlice({ loadBanks: loader.loadBanks });
  await flush();
  mounted.dispatch({
    type: 'question/field-changed',
    questionId: 'alpha-q1',
    field: 'text',
    value: 'PRECIOUS UNSAVED WORK',
  });

  clickRetry(mounted);
  await flush();
  await flush();

  // Every loaded bank is still loaded, still drafted, still diffable.
  assert.deepEqual(Object.keys(mounted.route.cases), ['alpha']);
  assert.deepEqual(Object.keys(mounted.route.baseline), ['alpha']);
  assert.equal(
    mounted.route.cases.alpha.questions[0].text,
    'PRECIOUS UNSAVED WORK'
  );
  assert.equal(mounted.route.baseline.alpha.questions[0].text, 'A?');
  assert.equal(isDirty(mounted.route), true);
  assert.notEqual(mounted.route.cases.alpha, mounted.route.baseline.alpha);
  // The failure is still named, with the message from this attempt.
  assert.deepEqual(mounted.route.loadFailures, [
    { slug: 'beta', message: '503 (attempt 2)' },
  ]);
  assert.equal(mounted.route.retrying, false);
  assert.match(mounted.view().textContent ?? '', /beta \(503 \(attempt 2\)\)/);

  // And the control is armed again rather than stuck at "Retrying…".
  clickRetry(mounted);
  await flush();
  await flush();
  assert.deepEqual(loader.calls, [undefined, ['beta'], ['beta']]);
  assert.deepEqual(mounted.route.loadFailures, [
    { slug: 'beta', message: '503 (attempt 3)' },
  ]);
  mounted.unmount();
});

test('#549 a loader that rejects wholesale still names the failed slugs', async () => {
  const loader = recordingLoader((call) => {
    if (call === 1) return partiallyLoaded();
    throw new Error('bank artifacts unreachable');
  });
  const mounted = mountSlice({ loadBanks: loader.loadBanks });
  await flush();

  clickRetry(mounted);
  await flush();
  await flush();

  assert.deepEqual(mounted.route.loadFailures, [
    { slug: 'beta', message: 'bank artifacts unreachable' },
  ]);
  assert.deepEqual(Object.keys(mounted.route.cases), ['alpha']);
  assert.equal(mounted.route.retrying, false);
  mounted.unmount();
});

test('#549 a second press while a retry is in flight does not fetch twice', async () => {
  let release = /** @type {(value?: any) => void} */ (() => {});
  const loader = recordingLoader((call) =>
    call === 1
      ? partiallyLoaded()
      : new Promise((resolve) => {
          release = resolve;
        })
  );
  const mounted = mountSlice({ loadBanks: loader.loadBanks });
  await flush();

  clickRetry(mounted);
  await flush();
  assert.equal(mounted.route.retrying, true);
  const button = getByRole(mounted.view(), 'button', { name: /Retry/ });
  assert.equal(button.textContent, 'Retrying…');
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  clickRetry(mounted);
  await flush();
  assert.deepEqual(loader.calls, [undefined, ['beta']]);

  release({ banks: { beta: syntheticBank('beta', 'B?') }, failures: [] });
  await flush();
  await flush();
  assert.equal(mounted.route.retrying, false);
  assert.deepEqual(Object.keys(mounted.route.cases), ['alpha', 'beta']);
  mounted.unmount();
});

test('#549 a retry that resolves after unmount is discarded', async () => {
  let release = /** @type {(value?: any) => void} */ (() => {});
  const loader = recordingLoader((call) =>
    call === 1
      ? partiallyLoaded()
      : new Promise((resolve) => {
          release = resolve;
        })
  );
  const mounted = mountSlice({ loadBanks: loader.loadBanks });
  await flush();
  clickRetry(mounted);
  await flush();
  mounted.unmount();
  release({ banks: { beta: syntheticBank('beta', 'B?') }, failures: [] });
  await flush();
  await flush();

  assert.deepEqual(Object.keys(mounted.route.cases), ['alpha']);
  assert.deepEqual(mounted.route.loadFailures, [
    { slug: 'beta', message: '404' },
  ]);
});

test('#549 nothing loaded at all is still recoverable in place', async () => {
  const loader = recordingLoader((call) =>
    call === 1
      ? { banks: {}, failures: [{ slug: 'alpha', message: '404' }] }
      : { banks: { alpha: syntheticBank('alpha', 'A?') }, failures: [] }
  );
  const mounted = mountSlice({ loadBanks: loader.loadBanks });
  await flush();
  assert.match(
    mounted.view().textContent ?? '',
    /No Question Bank could be loaded/
  );

  clickRetry(mounted);
  await flush();
  await flush();

  assert.deepEqual(loader.calls, [undefined, ['alpha']]);
  assert.equal(mounted.route.activeSlug, 'alpha');
  assert.doesNotMatch(
    mounted.view().textContent ?? '',
    /No Question Bank could be loaded/
  );
  mounted.unmount();
});

test('#549 a retry is offered only where a bank actually failed', async () => {
  const clean = mountSlice({
    loadBanks: async () => ({ banks: liveBanks, failures: [] }),
  });
  await flush();
  assert.equal(queryByRole(clean.view(), 'button', { name: /Retry/ }), null);
  clean.unmount();

  // Nor when there is nothing loaded and nothing named as failed: there is no
  // slug to re-fetch, so a control would do nothing.
  const empty = mountSlice({
    loadBanks: async () => ({ banks: {}, failures: [] }),
  });
  await flush();
  const view = empty.view();
  assert.match(view.textContent ?? '', /No Question Bank artifacts/);
  assert.equal(queryByRole(view, 'button', { name: /Retry/ }), null);
  empty.unmount();
});

test('#549 bank/retry-requested marks the retry without clearing the failures', () => {
  const loaded = questionBankReducer(emptyRoute(), {
    type: 'bank/loaded',
    banks: { alpha: syntheticBank('alpha', 'A?') },
    failures: [{ slug: 'beta', message: '404' }],
  });
  assert.equal(loaded.retrying, false);

  const retrying = questionBankReducer(loaded, {
    type: 'bank/retry-requested',
  });

  assert.equal(retrying.retrying, true);
  // The failure is still true until the retry says otherwise.
  assert.deepEqual(retrying.loadFailures, [{ slug: 'beta', message: '404' }]);
  assert.deepEqual(retrying.cases, loaded.cases);
  assert.equal(
    questionBankReducer(retrying, {
      type: 'bank/refreshed',
      banks: { alpha: syntheticBank('alpha', 'A?') },
      failures: [],
    }).retrying,
    false
  );
});

test('#549 a publish landing during an in-flight retry is not rolled back', async () => {
  // The retry's union of "already loaded" and "just recovered" is built inside
  // the reducer, from the state at dispatch time. Built instead from anything
  // the effect captured before it awaited, the publish below is silently undone
  // — both halves reverting to the pre-publish artifact while publishStatus
  // still reads 'succeeded' and isDirty reads false.
  let release = /** @type {(value?: any) => void} */ (() => {});
  const loader = recordingLoader((call) =>
    call === 1
      ? partiallyLoaded()
      : new Promise((resolve) => {
          release = resolve;
        })
  );
  const mounted = mountSlice({ loadBanks: loader.loadBanks });
  await flush();
  mounted.dispatch({
    type: 'question/field-changed',
    questionId: 'alpha-q1',
    field: 'text',
    value: 'PUBLISHED WORDING',
  });

  clickRetry(mounted);
  await flush();
  assert.equal(mounted.route.retrying, true);

  // The curator publishes while the retry is still in the air; publishing
  // promotes their draft to the baseline.
  mounted.dispatch({ type: 'publish/succeeded', artifacts: {} });
  assert.equal(
    mounted.route.baseline.alpha.questions[0].text,
    'PUBLISHED WORDING'
  );

  release({ banks: { beta: syntheticBank('beta', 'B?') }, failures: [] });
  await flush();
  await flush();

  assert.equal(
    mounted.route.cases.alpha.questions[0].text,
    'PUBLISHED WORDING'
  );
  assert.equal(
    mounted.route.baseline.alpha.questions[0].text,
    'PUBLISHED WORDING'
  );
  assert.equal(mounted.route.publishStatus, 'succeeded');
  assert.equal(isDirty(mounted.route), false);
  assert.equal(mounted.route.cases.beta.questions[0].text, 'B?');
  assert.notEqual(mounted.route.cases.alpha, mounted.route.baseline.alpha);
  mounted.unmount();
});

test('#549 a wholesale initial load failure is recoverable in place too', async () => {
  let attempt = 0;
  /** @type {any[]} */
  const calls = [];
  const loadBanks = async (
    /** @type {any} */ _importers,
    /** @type {string[]|undefined} */ only
  ) => {
    calls.push(only);
    attempt += 1;
    if (attempt <= 2) throw new Error(`artifacts unreachable (${attempt})`);
    return { banks: { alpha: syntheticBank('alpha', 'A?') }, failures: [] };
  };
  const mounted = mountSlice({ loadBanks });
  await flush();
  assert.equal(mounted.route.loadError, 'artifacts unreachable (1)');
  assert.deepEqual(mounted.route.loadFailures, []);

  // Attempt 2 fails the same way, and must leave the control armed rather than
  // stuck at "Retrying…" — otherwise the first attempt is reload-only.
  clickRetry(mounted);
  await flush();
  await flush();
  assert.equal(mounted.route.loadError, 'artifacts unreachable (2)');
  assert.equal(mounted.route.retrying, false);

  clickRetry(mounted);
  await flush();
  await flush();

  // No named slugs to narrow to, so the retry re-runs the whole load.
  assert.deepEqual(calls, [undefined, undefined, undefined]);
  assert.equal(mounted.route.loadError, '');
  assert.equal(mounted.route.activeSlug, 'alpha');
  assert.equal(mounted.route.retrying, false);
  assert.notEqual(mounted.route.cases.alpha, mounted.route.baseline.alpha);
  mounted.unmount();
});

test('#549 bank/load-failed clears an in-flight retry', () => {
  const failed = questionBankReducer(
    { ...emptyRoute(), retrying: true },
    { type: 'bank/load-failed', message: 'unreachable' }
  );
  assert.equal(failed.retrying, false);
  assert.equal(failed.loadError, 'unreachable');
  assert.equal(failed.loading, false);
});

test('#549 bank/retry-requested refuses when there is nothing to re-fetch', () => {
  // Latching `retrying` with no effect behind it is the dead end this guard
  // exists to prevent: nothing else clears it.
  const loaded = questionBankReducer(emptyRoute(), {
    type: 'bank/loaded',
    banks: { alpha: syntheticBank('alpha', 'A?') },
    failures: [],
  });
  assert.equal(
    questionBankReducer(loaded, { type: 'bank/retry-requested' }),
    loaded
  );
});

test('#549 the Retry control is rendered only when a retry tool backs it', () => {
  // Without one there is nothing to run: the control would set `retrying` and
  // strand itself at "Retrying…" forever.
  const state = {
    chrome: context().chrome,
    routes: {
      questionBank: questionBankReducer(emptyRoute(), {
        type: 'bank/loaded',
        banks: { alpha: syntheticBank('alpha', 'A?') },
        failures: [{ slug: 'beta', message: '404' }],
      }),
    },
  };
  const dispatch = (/** @type {any} */ action) => action;

  const bare = bankEditorView(/** @type {any} */ (state), { dispatch });
  assert.match(bare.textContent ?? '', /Some Question Banks could not be/);
  assert.equal(queryByRole(bare, 'button', { name: /Retry/ }), null);

  const wired = bankEditorView(/** @type {any} */ (state), {
    dispatch,
    retry: () => {},
  });
  assert.notEqual(queryByRole(wired, 'button', { name: /Retry/ }), null);
});

test('#549 the Retry control sits outside the live region and keeps focus', async () => {
  const loader = recordingLoader((call) =>
    call === 1
      ? partiallyLoaded()
      : new Promise(() => {
          // never settles: the assertions below are about the busy state
        })
  );
  const mounted = mountSlice({ loadBanks: loader.loadBanks });
  await flush();

  const idle = getByRole(mounted.view(), 'button', { name: /Retry/ });
  // `disabled` would drop focus to the document on click; `aria-disabled`
  // announces the same state and keeps the keyboard curator where they are.
  assert.equal(Boolean(idle.disabled), false);
  assert.equal(idle.getAttribute('aria-disabled'), 'false');
  assert.equal(idle.getAttribute('aria-busy'), 'false');
  // The live region covers the failure message only: with the control inside
  // it, every label toggle re-announces the whole failure list.
  assert.equal(
    queryByRole(getByRole(mounted.view(), 'status'), 'button', {
      name: /Retry/,
    }),
    null
  );

  clickRetry(mounted);
  await flush();
  const busy = getByRole(mounted.view(), 'button', { name: /Retrying/ });
  assert.equal(Boolean(busy.disabled), false);
  assert.equal(busy.getAttribute('aria-disabled'), 'true');
  assert.equal(busy.getAttribute('aria-busy'), 'true');
  mounted.unmount();
});
