// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaseReviewViewModel } from '../src/lib/case-review-view-model.js';
import { signal, effect } from '../src/lib/signal.js';

/**
 * Builds a view model wired just enough to exercise handleCapture: an editable
 * machine, a one-field capture group, and a stubbed save queue.
 * @param {(...args: any[]) => void} enqueue
 */
function makeVM(enqueue) {
  const vm = new CaseReviewViewModel(
    /** @type {any} */ ({}),
    /** @type {any} */ ({ enqueue }),
    'c1',
    'u1',
    null
  );
  vm.machine = /** @type {any} */ ({ canCapture: true });
  vm.config = /** @type {any} */ ({
    captureGroups: [
      { key: 'cause', fields: [{ key: 'rootCause', type: 'text' }] },
    ],
  });
  vm.answersSignal = signal(/** @type {any} */ ({ q1: { value: 'No' } }));
  return vm;
}

test('handleCapture restores window scroll after the re-render shifts it', () => {
  let scrollY = 500;
  /** @type {any} */ (globalThis).window = {
    scrollX: 0,
    get scrollY() {
      return scrollY;
    },
    scrollTo(/** @type {number} */ _x, /** @type {number} */ y) {
      scrollY = y;
    },
  };
  try {
    /** @type {any[]} */
    const calls = [];
    const vm = makeVM((...a) => calls.push(a));

    // Simulate the Issues re-render: any answers change "jumps" the scroll, as a
    // real DOM teardown above the viewport would.
    let first = true;
    effect(() => {
      vm.answersSignal.get();
      if (!first) scrollY = 0;
      first = false;
    });

    vm.handleCapture('q1', 'rootCause', 'Agent rushed');

    assert.equal(scrollY, 500, 'scroll position restored after the jump');
    assert.equal(calls.length, 1, 'still enqueues the save');
    assert.deepEqual(calls[0][2].q1.capture, { rootCause: 'Agent rushed' });
  } finally {
    delete (/** @type {any} */ (globalThis).window);
  }
});

test('handleCapture works (no throw) when window is absent', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  /** @type {any[]} */
  const calls = [];
  const vm = makeVM((...a) => calls.push(a));
  vm.handleCapture('q1', 'rootCause', 'x');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][2].q1.capture, { rootCause: 'x' });
});

// --- exportHash loading (ADR-0021 Step 3) ---

test('CaseReviewViewModel.load() calls getExportHash with the case type slug and stores it as exportHash', async () => {
  const vm = new CaseReviewViewModel(
    /** @type {any} */ ({
      getCase: async () => ({
        id: 'c1',
        caseType: 'example-review',
        title: 'T',
        status: 'In-progress',
        assignedReviewer: 'u1',
        responsibleParty: 'u2',
        answers: {},
        conversation: [],
        notes: '',
        completedAt: null,
        etag: 'e1',
      }),
      getCurrentUser: async () => ({ id: 'u1', displayName: 'User 1' }),
      getExportHash: async (slug) =>
        slug === 'example-review' ? 'sha256:testHash' : null,
      resolveUsers: async () => ({}),
    }),
    /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    'c1',
    'u1',
    null
  );

  await vm.load();

  assert.equal(
    vm.exportHash,
    'sha256:testHash',
    'exportHash is stored from getExportHash result'
  );
});

test('CaseReviewViewModel.load() stores null exportHash when getExportHash returns null', async () => {
  const vm = new CaseReviewViewModel(
    /** @type {any} */ ({
      getCase: async () => ({
        id: 'c1',
        caseType: 'example-review',
        title: 'T',
        status: 'In-progress',
        assignedReviewer: 'u1',
        responsibleParty: 'u2',
        answers: {},
        conversation: [],
        notes: '',
        completedAt: null,
        etag: 'e1',
      }),
      getCurrentUser: async () => ({ id: 'u1', displayName: 'User 1' }),
      getExportHash: async () => null,
      resolveUsers: async () => ({}),
    }),
    /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    'c1',
    'u1',
    null
  );

  await vm.load();

  assert.equal(vm.exportHash, null);
});

// --- versioned catalogue loading (ADR-0021 Step 4) ---

/** Minimal stub client for Step 4 tests. */
function makeStep4Client({
  status = /** @type {'In-progress'|'Completed'} */ ('In-progress'),
  questionBankVersion = /** @type {string|undefined} */ (undefined),
  versionedExport = /** @type {any} */ (null),
} = {}) {
  return /** @type {any} */ ({
    getCase: async () => ({
      id: 'c1',
      caseType: 'example-review',
      title: 'T',
      status,
      assignedReviewer: 'u1',
      responsibleParty: 'u2',
      answers: { 'q-welcome': { value: 'Yes' } },
      conversation: [],
      notes: '',
      completedAt: status === 'Completed' ? '2026-01-01T00:00:00Z' : null,
      questionBankVersion,
      etag: 'e1',
    }),
    getCurrentUser: async () => ({ id: 'u1', displayName: 'User 1' }),
    getExportHash: async () => null,
    getVersionedExport: async () => versionedExport,
    resolveUsers: async () => ({}),
  });
}

const versionedCatalogue = [
  {
    id: 'q-old',
    text: 'A question from version time',
    category: 'Context',
    responseType: 'yes-no-na',
    options: null,
    showWhen: null,
    failureCriteria: 'No',
    deprecated: false,
  },
  {
    id: 'q-deprecated-then',
    text: 'Was deprecated at completion',
    category: null,
    responseType: 'yes-no-na',
    options: null,
    showWhen: null,
    failureCriteria: null,
    deprecated: true,
  },
];

test('CaseReviewViewModel.load() uses versioned catalogue for Completed Case with questionBankVersion (ADR-0021 Step 4)', async () => {
  const vm = new CaseReviewViewModel(
    makeStep4Client({
      status: 'Completed',
      questionBankVersion: 'sha256:abc123',
      versionedExport: { slug: 'example-review', questions: versionedCatalogue },
    }),
    /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    'c1', 'u1', null
  );

  await vm.load();

  assert.equal(vm.catalogue.length, 1, 'only non-deprecated versioned questions');
  assert.equal(vm.catalogue[0].id, 'q-old', 'id from versioned file');
  assert.equal(vm.catalogue[0].text, 'A question from version time', 'text from versioned file');
});

test('CaseReviewViewModel.load(): versioned catalogue mapping normalises null optional fields to undefined', async () => {
  const vm = new CaseReviewViewModel(
    makeStep4Client({
      status: 'Completed',
      questionBankVersion: 'sha256:abc123',
      versionedExport: {
        slug: 'example-review',
        questions: [{ id: 'q1', text: 'T', category: null, responseType: 'yes-no-na', options: null, showWhen: null, failureCriteria: null, deprecated: false }],
      },
    }),
    /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    'c1', 'u1', null
  );

  await vm.load();

  const q = vm.catalogue[0];
  assert.equal(q.category, undefined);
  assert.equal(q.options, undefined);
  assert.equal(q.showWhen, undefined);
  assert.equal(q.failureCriteria, undefined);
});

test('CaseReviewViewModel.load(): versioned catalogue carries labelIds when present', async () => {
  const vm = new CaseReviewViewModel(
    makeStep4Client({
      status: 'Completed',
      questionBankVersion: 'sha256:abc123',
      versionedExport: {
        slug: 'example-review',
        questions: [{ id: 'q1', text: 'T', category: null, responseType: 'yes-no-na', options: null, showWhen: null, failureCriteria: null, deprecated: false, labelIds: ['lbl-a'] }],
      },
    }),
    /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    'c1', 'u1', null
  );

  await vm.load();

  assert.deepEqual(vm.catalogue[0].labelIds, ['lbl-a']);
});

test('CaseReviewViewModel.load(): missing versioned file falls back to live catalogue + versionWarning (ADR-0021 Step 4)', async () => {
  const vm = new CaseReviewViewModel(
    makeStep4Client({ status: 'Completed', questionBankVersion: 'sha256:abc123', versionedExport: null }),
    /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    'c1', 'u1', null
  );

  await vm.load();

  const liveIds = new Set(vm.catalogue.map((q) => q.id));
  assert.ok(liveIds.has('q-welcome'), 'falls back to live bank');
  assert.ok(
    vm.versionWarning.get() !== null && vm.versionWarning.get() !== '',
    'versionWarning is set when versioned file is missing'
  );
});

test('CaseReviewViewModel.load(): In-progress Case loads live catalogue; versionWarning stays null (ADR-0021 Step 4)', async () => {
  const vm = new CaseReviewViewModel(
    makeStep4Client({ status: 'In-progress' }),
    /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    'c1', 'u1', null
  );

  await vm.load();

  const liveIds = new Set(vm.catalogue.map((q) => q.id));
  assert.ok(liveIds.has('q-welcome'), 'live bank loaded');
  assert.equal(vm.versionWarning.get(), null, 'no warning for in-progress case');
});

test('CaseReviewViewModel.load(): Completed Case without questionBankVersion falls back to live (backward compat, ADR-0021 Step 4)', async () => {
  const vm = new CaseReviewViewModel(
    makeStep4Client({ status: 'Completed', questionBankVersion: undefined }),
    /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    'c1', 'u1', null
  );

  await vm.load();

  const liveIds = new Set(vm.catalogue.map((q) => q.id));
  assert.ok(liveIds.has('q-welcome'), 'legacy: live bank loaded');
  assert.equal(vm.versionWarning.get(), null, 'no warning for legacy cases');
});
