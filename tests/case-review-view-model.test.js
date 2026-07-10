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
  const vm = new CaseReviewViewModel({
    client: /** @type {any} */ ({}),
    saveQueue: /** @type {any} */ ({ enqueue }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });
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

test('handleCapture restores the app scroll container, not the (unscrolled) window', () => {
  // In the real app the root #app[data-cora-root] is position:fixed with its own
  // overflow-y:auto, so the window never scrolls — window.scrollTo is a no-op and
  // the Issues re-render throws the Reviewer around. The scroll must be preserved
  // on the app container instead.
  let containerTop = 500;
  const container = {
    getAttribute: () => '',
    get scrollTop() {
      return containerTop;
    },
    set scrollTop(v) {
      containerTop = v;
    },
    scrollLeft: 0,
  };
  let windowScrollY = 0;
  /** @type {any} */ (globalThis).window = {
    scrollX: 0,
    get scrollY() {
      return windowScrollY;
    },
    scrollTo(/** @type {number} */ _x, /** @type {number} */ y) {
      windowScrollY = y;
    },
  };
  /** @type {any} */ (globalThis).document = {
    querySelector: (/** @type {string} */ sel) =>
      sel === '#app[data-cora-root]' ? container : null,
  };
  try {
    const vm = makeVM(() => {});
    // The re-render churns the container scroll (as a real DOM teardown does).
    let first = true;
    effect(() => {
      vm.answersSignal.get();
      if (!first) containerTop = 0;
      first = false;
    });

    vm.handleCapture('q1', 'rootCause', 'Agent rushed');

    assert.equal(
      containerTop,
      500,
      'app container scroll restored after the jump'
    );
  } finally {
    delete (/** @type {any} */ (globalThis).window);
    delete (/** @type {any} */ (globalThis).document);
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

// --- handleRemediationAction / handleRemediationFreeForm (issue #250) ---

/**
 * @param {(...args: any[]) => void} enqueue
 * @param {any} [answer]
 * @param {boolean} [canSelectRemediation]
 */
function makeSelectionVM(
  enqueue,
  answer = { value: 'No' },
  canSelectRemediation = true
) {
  const vm = new CaseReviewViewModel({
    client: /** @type {any} */ ({}),
    saveQueue: /** @type {any} */ ({ enqueue }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });
  vm.machine = /** @type {any} */ ({ canSelectRemediation });
  vm.answersSignal = signal(/** @type {any} */ ({ q1: answer }));
  return vm;
}

test('handleRemediationAction: ticking an action writes its id onto answer.remediationActions', () => {
  /** @type {any[]} */
  const calls = [];
  const vm = makeSelectionVM((...a) => calls.push(a));
  vm.handleRemediationAction('q1', { id: 'ra-0', text: 'Retrain' }, true);

  assert.deepEqual(vm.answersSignal.get().q1.remediationActions, [
    { id: 'ra-0', text: 'Retrain', completed: false },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'answers');
});

test('handleRemediationAction: unticking removes the action, dropping the key when empty', () => {
  /** @type {any[]} */
  const calls = [];
  const vm = makeSelectionVM((...a) => calls.push(a), {
    value: 'No',
    remediationActions: [{ id: 'ra-0', text: 'Retrain', completed: false }],
  });
  vm.handleRemediationAction('q1', { id: 'ra-0', text: 'Retrain' }, false);

  assert.equal(
    'remediationActions' in vm.answersSignal.get().q1,
    false,
    'the empty selection key is removed, not left as []'
  );
  assert.equal(calls.length, 1);
});

test('handleRemediationAction: ticking preserves other selected actions', () => {
  const vm = makeSelectionVM(() => {}, {
    value: 'No',
    remediationActions: [{ id: 'ra-0', text: 'Retrain', completed: false }],
  });
  vm.handleRemediationAction('q1', { id: 'ra-1', text: 'Update script' }, true);

  assert.deepEqual(vm.answersSignal.get().q1.remediationActions, [
    { id: 'ra-0', text: 'Retrain', completed: false },
    { id: 'ra-1', text: 'Update script', completed: false },
  ]);
});

test('handleRemediationAction: re-ticking an already-selected action is a no-op', () => {
  /** @type {any[]} */
  const calls = [];
  const vm = makeSelectionVM((...a) => calls.push(a), {
    value: 'No',
    remediationActions: [{ id: 'ra-0', text: 'Retrain', completed: false }],
  });
  vm.handleRemediationAction('q1', { id: 'ra-0', text: 'Retrain' }, true);
  assert.equal(calls.length, 0, 'no redundant save');
});

test('handleRemediationAction: unticking an unselected action is a no-op', () => {
  /** @type {any[]} */
  const calls = [];
  const vm = makeSelectionVM((...a) => calls.push(a));
  vm.handleRemediationAction('q1', { id: 'ra-0', text: 'Retrain' }, false);
  assert.equal(calls.length, 0);
});

test('handleRemediationAction: ignored when canSelectRemediation is false', () => {
  /** @type {any[]} */
  const calls = [];
  const vm = makeSelectionVM((...a) => calls.push(a), { value: 'No' }, false);
  vm.handleRemediationAction('q1', { id: 'ra-0', text: 'Retrain' }, true);
  assert.equal(calls.length, 0);
});

test('handleRemediationAction: ignored when the Answer does not exist', () => {
  /** @type {any[]} */
  const calls = [];
  const vm = makeSelectionVM((...a) => calls.push(a));
  vm.handleRemediationAction('missing', { id: 'ra-0', text: 'Retrain' }, true);
  assert.equal(calls.length, 0);
});

test('handleRemediationFreeForm: stores the value on the Answer', () => {
  /** @type {any[]} */
  const calls = [];
  const vm = makeSelectionVM((...a) => calls.push(a));
  vm.handleRemediationFreeForm('q1', 'Escalate to legal');

  assert.equal(
    vm.answersSignal.get().q1.freeFormRemediation,
    'Escalate to legal'
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'answers');
});

test('handleRemediationFreeForm: an empty value clears the field', () => {
  const vm = makeSelectionVM(() => {}, {
    value: 'No',
    freeFormRemediation: 'Old text',
  });
  vm.handleRemediationFreeForm('q1', '');

  assert.equal(
    'freeFormRemediation' in vm.answersSignal.get().q1,
    false,
    'clearing removes the key'
  );
});

test('handleRemediationFreeForm: ignored when canSelectRemediation is false', () => {
  /** @type {any[]} */
  const calls = [];
  const vm = makeSelectionVM((...a) => calls.push(a), { value: 'No' }, false);
  vm.handleRemediationFreeForm('q1', 'x');
  assert.equal(calls.length, 0);
});

test('handleRemediationFreeForm: ignored when the Answer does not exist', () => {
  /** @type {any[]} */
  const calls = [];
  const vm = makeSelectionVM((...a) => calls.push(a));
  vm.handleRemediationFreeForm('missing', 'x');
  assert.equal(calls.length, 0);
});

// --- handleActionStatus: Remediation tracking (ADR-0024) ---

/**
 * @param {(...args: any[]) => void} enqueue
 * @param {string} [access]
 * @param {any} [acts]
 */
function makeTrackingVM(
  enqueue,
  access = 'edit',
  acts = [{ id: 'a1', text: 'Do it', status: 'pending' }]
) {
  const vm = new CaseReviewViewModel({
    client: /** @type {any} */ ({}),
    saveQueue: /** @type {any} */ ({ enqueue }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });
  vm.access = /** @type {any} */ ({ remediation: access });
  vm.answersSignal = signal(
    /** @type {any} */ ({ q1: { value: 'No', capture: { acts } } })
  );
  return vm;
}

test('handleActionStatus: resolves an action to complete and persists', () => {
  /** @type {any[]} */
  const calls = [];
  const vm = makeTrackingVM((...a) => calls.push(a));
  vm.handleActionStatus('q1', 'acts', 'a1', 'complete');
  assert.equal(calls.length, 1);
  assert.deepEqual(vm.answersSignal.get().q1.capture?.acts, [
    { id: 'a1', text: 'Do it', status: 'complete' },
  ]);
});

test('handleActionStatus: cancelling with a reason persists the reason', () => {
  /** @type {any[]} */
  const calls = [];
  const vm = makeTrackingVM((...a) => calls.push(a));
  vm.handleActionStatus('q1', 'acts', 'a1', 'cancelled', 'no longer needed');
  assert.deepEqual(vm.answersSignal.get().q1.capture?.acts, [
    {
      id: 'a1',
      text: 'Do it',
      status: 'cancelled',
      cancelReason: 'no longer needed',
    },
  ]);
});

test('handleActionStatus: cancelling without a reason is dropped (hard validation)', () => {
  /** @type {any[]} */
  const calls = [];
  const vm = makeTrackingVM((...a) => calls.push(a));
  vm.handleActionStatus('q1', 'acts', 'a1', 'cancelled');
  assert.equal(calls.length, 0, 'invalid resolution is not persisted');
  assert.deepEqual(vm.answersSignal.get().q1.capture?.acts, [
    { id: 'a1', text: 'Do it', status: 'pending' },
  ]);
});

test('handleActionStatus: coerces legacy string actions to objects on write', () => {
  /** @type {any[]} */
  const calls = [];
  const vm = makeTrackingVM((...a) => calls.push(a), 'edit', ['legacy']);
  vm.handleActionStatus('q1', 'acts', 'acts-0', 'complete');
  assert.deepEqual(vm.answersSignal.get().q1.capture?.acts, [
    { id: 'acts-0', text: 'legacy', status: 'complete' },
  ]);
});

test('handleActionStatus: no-op when the viewer cannot resolve (read-only)', () => {
  /** @type {any[]} */
  const calls = [];
  const vm = makeTrackingVM((...a) => calls.push(a), 'read-only');
  vm.handleActionStatus('q1', 'acts', 'a1', 'complete');
  assert.equal(calls.length, 0);
});

test('handleActionStatus: no-op for a missing answer, non-array field, or unknown action id', () => {
  /** @type {any[]} */
  const calls = [];
  const vm = makeTrackingVM((...a) => calls.push(a));
  vm.handleActionStatus('missing', 'acts', 'a1', 'complete');
  vm.handleActionStatus('q1', 'notAnArray', 'a1', 'complete');
  vm.handleActionStatus('q1', 'acts', 'nope', 'complete');
  assert.equal(calls.length, 0);
});

// --- exportHash loading (ADR-0021 Step 3) ---

test('CaseReviewViewModel.load() calls getExportHash with the case type slug and stores it as exportHash', async () => {
  const vm = new CaseReviewViewModel({
    client: /** @type {any} */ ({
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
      getExportHash: async (/** @type {string} */ slug) =>
        slug === 'example-review' ? 'sha256:testHash' : null,
      resolveUsers: async () => ({}),
    }),
    saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });

  await vm.load();

  assert.equal(
    vm.exportHash,
    'sha256:testHash',
    'exportHash is stored from getExportHash result'
  );
});

test('CaseReviewViewModel.load() resolves route caseType to listName for getCase and SaveQueue', async () => {
  /** @type {any[]} */
  const getCaseCalls = [];
  /** @type {any[]} */
  const loadCaseCalls = [];
  const row = {
    id: 'c1',
    caseType: 'product-sale-review',
    title: 'T',
    status: 'In-progress',
    assignedReviewer: 'u1',
    responsibleParty: 'u2',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'e1',
  };
  const vm = new CaseReviewViewModel({
    client: /** @type {any} */ ({
      getCase: async (
        /** @type {string} */ id,
        /** @type {import('../src/sharepoint-client.js').CaseListOptions | undefined} */ opts
      ) => {
        getCaseCalls.push({ id, opts });
        return row;
      },
      getCurrentUser: async () => ({ id: 'u1', displayName: 'User 1' }),
      getExportHash: async () => null,
      resolveUsers: async () => ({}),
    }),
    saveQueue: /** @type {any} */ ({
      loadCase: (
        /** @type {import('../src/sharepoint-client.js').CaseRow} */ row,
        /** @type {import('../src/sharepoint-client.js').CaseListOptions | undefined} */ opts
      ) => loadCaseCalls.push([row, opts]),
      enqueue: () => {},
    }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
    caseType: 'product-sale-review',
  });

  await vm.load();

  assert.deepEqual(getCaseCalls[0], {
    id: 'c1',
    opts: { listName: 'complaints' },
  });
  assert.deepEqual(loadCaseCalls[0], [row, { listName: 'complaints' }]);
  assert.deepEqual(vm.caseListOptions, { listName: 'complaints' });
});

test('CaseReviewViewModel.load() stores null exportHash when getExportHash returns null', async () => {
  const vm = new CaseReviewViewModel({
    client: /** @type {any} */ ({
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
    saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });

  await vm.load();

  assert.equal(vm.exportHash, null);
});

// --- versioned catalogue loading (ADR-0021 Step 4) ---

/** Minimal stub client for Step 4 tests. */
function makeStep4Client({
  status = /** @type {'In-progress'|'Actions In Progress'|'Completed'} */ (
    'In-progress'
  ),
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
  const vm = new CaseReviewViewModel({
    client: makeStep4Client({
      status: 'Completed',
      questionBankVersion: 'sha256:abc123',
      versionedExport: {
        slug: 'example-review',
        questions: versionedCatalogue,
      },
    }),
    saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });

  await vm.load();

  assert.equal(
    vm.catalogue.length,
    1,
    'only non-deprecated versioned questions'
  );
  assert.equal(vm.catalogue[0].id, 'q-old', 'id from versioned file');
  assert.equal(
    vm.catalogue[0].text,
    'A question from version time',
    'text from versioned file'
  );
});

test('CaseReviewViewModel.load(): Actions In Progress Case freezes on the versioned catalogue — no reopen once reportable (ADR-0023)', async () => {
  const vm = new CaseReviewViewModel({
    client: makeStep4Client({
      status: 'Actions In Progress',
      questionBankVersion: 'sha256:abc123',
      versionedExport: {
        slug: 'example-review',
        questions: versionedCatalogue,
      },
    }),
    saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });

  await vm.load();

  // The reportable milestone (ADR-0023) freezes the bank as-reviewed: an
  // 'Actions In Progress' Case loads the versioned snapshot exactly like a
  // Completed one, so a Question added to the live bank cannot reopen it.
  const ids = new Set(vm.catalogue.map((q) => q.id));
  assert.deepEqual([...ids], ['q-old'], 'frozen to the as-reviewed snapshot');
  assert.ok(
    !ids.has('q-welcome'),
    'a live-bank Question does not reopen a reportable Case'
  );
  assert.equal(vm.versionWarning.get(), null, 'snapshot resolved, no warning');
});

test('CaseReviewViewModel.load(): versioned catalogue mapping normalises null optional fields to undefined', async () => {
  const vm = new CaseReviewViewModel({
    client: makeStep4Client({
      status: 'Completed',
      questionBankVersion: 'sha256:abc123',
      versionedExport: {
        slug: 'example-review',
        questions: [
          {
            id: 'q1',
            text: 'T',
            category: null,
            responseType: 'yes-no-na',
            options: null,
            showWhen: null,
            failureCriteria: null,
            deprecated: false,
          },
        ],
      },
    }),
    saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });

  await vm.load();

  const q = vm.catalogue[0];
  assert.equal(q.category, undefined);
  assert.equal(q.options, undefined);
  assert.equal(q.showWhen, undefined);
  assert.equal(q.failureCriteria, undefined);
});

test('CaseReviewViewModel.load(): versioned catalogue carries labelIds when present', async () => {
  const vm = new CaseReviewViewModel({
    client: makeStep4Client({
      status: 'Completed',
      questionBankVersion: 'sha256:abc123',
      versionedExport: {
        slug: 'example-review',
        questions: [
          {
            id: 'q1',
            text: 'T',
            category: null,
            responseType: 'yes-no-na',
            options: null,
            showWhen: null,
            failureCriteria: null,
            deprecated: false,
            labelIds: ['lbl-a'],
          },
        ],
      },
    }),
    saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });

  await vm.load();

  assert.deepEqual(vm.catalogue[0].labelIds, ['lbl-a']);
});

test('CaseReviewViewModel.load(): missing versioned file falls back to live catalogue + versionWarning (ADR-0021 Step 4)', async () => {
  const vm = new CaseReviewViewModel({
    client: makeStep4Client({
      status: 'Completed',
      questionBankVersion: 'sha256:abc123',
      versionedExport: null,
    }),
    saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });

  await vm.load();

  const liveIds = new Set(vm.catalogue.map((q) => q.id));
  assert.ok(liveIds.has('q-welcome'), 'falls back to live bank');
  assert.ok(
    vm.versionWarning.get() !== null && vm.versionWarning.get() !== '',
    'versionWarning is set when versioned file is missing'
  );
});

test('CaseReviewViewModel.load(): In-progress Case loads live catalogue; versionWarning stays null (ADR-0021 Step 4)', async () => {
  const vm = new CaseReviewViewModel({
    client: makeStep4Client({ status: 'In-progress' }),
    saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });

  await vm.load();

  const liveIds = new Set(vm.catalogue.map((q) => q.id));
  assert.ok(liveIds.has('q-welcome'), 'live bank loaded');
  assert.equal(
    vm.versionWarning.get(),
    null,
    'no warning for in-progress case'
  );
});

test('CaseReviewViewModel.load(): Completed Case without questionBankVersion falls back to live (backward compat, ADR-0021 Step 4)', async () => {
  const vm = new CaseReviewViewModel({
    client: makeStep4Client({
      status: 'Completed',
      questionBankVersion: undefined,
    }),
    saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });

  await vm.load();

  const liveIds = new Set(vm.catalogue.map((q) => q.id));
  assert.ok(liveIds.has('q-welcome'), 'legacy: live bank loaded');
  assert.equal(vm.versionWarning.get(), null, 'no warning for legacy cases');
});

// --- Case Type sectionLabels resolution (MAINT-11) ---

/** @param {string} caseType */
function makeLabelsVM(caseType) {
  return new CaseReviewViewModel({
    client: /** @type {any} */ ({
      getCase: async () => ({
        id: 'c1',
        caseType,
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
    saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });
}

test('CaseReviewViewModel: sectionLabels/sectionHeadings default before load()', () => {
  const vm = makeLabelsVM('example-review');
  assert.equal(vm.sectionLabels.questions, 'Review');
  assert.equal(vm.sectionHeadings.questions, 'Questions');
  assert.equal(vm.sectionLabels.notes, 'Notes');
});

test('CaseReviewViewModel.load(): a Case Type without sectionLabels keeps the defaults', async () => {
  const vm = makeLabelsVM('example-review');
  await vm.load();
  assert.equal(vm.sectionLabels.questions, 'Review');
  assert.equal(vm.sectionHeadings.questions, 'Questions');
  assert.equal(vm.sectionLabels.appealReview, 'Appeal Review');
});

test('CaseReviewViewModel.load(): resolves a Case Type sectionLabels override into labels and headings', async () => {
  // stress-review declares the demonstrative { questions: 'Assessment' } override.
  const vm = makeLabelsVM('stress-review');
  await vm.load();
  assert.equal(vm.sectionLabels.questions, 'Assessment');
  assert.equal(vm.sectionHeadings.questions, 'Assessment');
  // Every other Section keeps the defaults.
  assert.equal(vm.sectionLabels.notes, 'Notes');
  assert.equal(vm.sectionHeadings.remediation, 'Remediation');
});
