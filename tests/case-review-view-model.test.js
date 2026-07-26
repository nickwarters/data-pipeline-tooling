// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaseReviewViewModel } from '../src/lib/case-review-view-model.js';
import { CASE_TYPE_IMPORTERS } from '../case-types/manifest.js';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';

isolateBrowserGlobals();

test('the loader holds its loading state as plain fields, not signals (#529)', () => {
  const vm = new CaseReviewViewModel({
    client: /** @type {any} */ ({}),
    saveQueue: /** @type {any} */ ({ enqueue() {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });

  const snapshot = vm.toStoreSnapshot();
  assert.equal(snapshot.loaded, false);
  assert.equal(snapshot.error, null);
  assert.equal(snapshot.accessDenied, false);

  // The snapshot is the public seam and proves the handover is unchanged, but
  // it cannot on its own prove the conversion: `toStoreSnapshot()` read the
  // same values through `.get()` before. One structural assertion carries the
  // ticket's actual claim — the loading state is no longer a notifier.
  for (const field of ['loaded', 'error', 'accessDenied']) {
    assert.equal(
      typeof /** @type {any} */ ((vm)[field] ?? {}).get,
      'undefined',
      `${field} must be a plain field, not a signal`
    );
  }
});

test('toStoreSnapshot: an empty multi-choice Answer is unanswered on load', () => {
  const vm = new CaseReviewViewModel({
    client: /** @type {any} */ ({}),
    saveQueue: /** @type {any} */ ({ enqueue() {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });
  vm.catalogue = [
    {
      id: 'q1',
      text: 'Select every applicable issue',
      responseType: 'multi-choice',
      options: ['Issue A'],
      deprecated: false,
    },
  ];
  vm.answers = { q1: { value: [] } };

  assert.equal(vm.toStoreSnapshot().allAnswered, false);
});

test('toStoreSnapshot: the loader hands over Answers and the derived applicable set', () => {
  const vm = new CaseReviewViewModel({
    client: /** @type {any} */ ({}),
    saveQueue: /** @type {any} */ ({ enqueue() {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });
  vm.catalogue = [
    { id: 'q1', text: 'One', responseType: 'yes-no-na', deprecated: false },
    {
      id: 'q2',
      text: 'Only when q1 is No',
      responseType: 'yes-no-na',
      showWhen: { q1: { equals: 'No' } },
      deprecated: false,
    },
  ];
  vm.answers = { q1: { value: 'Yes' } };

  const snapshot = vm.toStoreSnapshot();
  assert.equal(snapshot.answers, vm.answers);
  assert.deepEqual(
    snapshot.applicableQuestions.map((q) => q.id),
    ['q1']
  );
});

test('CaseReviewViewModel exposes no Answer mutation surface (#510)', () => {
  // The store is the single Answer owner: the loader loads, and the route's
  // answer-actions are the only writers.
  const vm = new CaseReviewViewModel({
    client: /** @type {any} */ ({}),
    saveQueue: /** @type {any} */ ({ enqueue() {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });
  for (const name of [
    'handleAnswer',
    'handleCapture',
    'handleAttribute',
    'handleRemediationAction',
    'handleRemediationFreeForm',
    'handleRemediationStatus',
    'setAnswerChangeHandler',
  ]) {
    assert.equal(
      typeof (/** @type {any} */ (vm)[name]),
      'undefined',
      `${name} must not exist on the loader`
    );
  }
  assert.equal('answersSignal' in vm, false);
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
    caseType: 'example-review',
  });

  await vm.load();

  assert.deepEqual(getCaseCalls[0], {
    id: 'c1',
    opts: { listName: 'Cases-ExampleReview' },
  });
  assert.deepEqual(loadCaseCalls[0], [
    row,
    { listName: 'Cases-ExampleReview' },
  ]);
  assert.deepEqual(vm.caseListOptions, { listName: 'Cases-ExampleReview' });
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
    optionOutcomes: { No: 'fail' },
    showWhen: null,
    deprecated: false,
  },
  {
    id: 'q-deprecated-then',
    text: 'Was deprecated at completion',
    category: null,
    responseType: 'yes-no-na',
    options: null,
    showWhen: null,
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
  assert.equal('failureCriteria' in q, false);
});

test('CaseReviewViewModel.load(): live catalogue derives failureValues from the config outcome mapping', async () => {
  const vm = new CaseReviewViewModel({
    client: makeStep4Client(),
    saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });

  await vm.load();

  const q = vm.catalogue.find((x) => x.id === 'q-welcome');
  assert.deepEqual(q?.failureValues, ['No']);
});

test('CaseReviewViewModel.load(): frozen catalogue derives failureValues against the snapshot default Outcome', async () => {
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
            optionOutcomes: { No: 'bad', Yes: 'good' },
            showWhen: null,
            deprecated: false,
          },
        ],
        outcomeOptions: [
          { id: 'good', wording: 'Good', severity: 0 },
          { id: 'bad', wording: 'Bad', severity: 100 },
        ],
        // Differs from the live config's default ('pass') — the snapshot's
        // vocabulary governs the as-reviewed failure semantics.
        defaultOutcomeId: 'good',
      },
    }),
    saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });

  await vm.load();

  assert.deepEqual(vm.catalogue[0].failureValues, ['No']);
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

  // A stamped-but-unpublished version is a broken publish, and the banner only
  // reaches whoever opens the Case. The log is the operator's copy (#513).
  const originalError = console.error;
  /** @type {unknown[]} */
  const logged = [];
  console.error = (/** @type {unknown} */ message) => logged.push(message);
  try {
    await vm.load();
  } finally {
    console.error = originalError;
  }

  const liveIds = new Set(vm.catalogue.map((q) => q.id));
  assert.ok(liveIds.has('q-welcome'), 'falls back to live bank');
  assert.ok(
    vm.versionWarning.get() !== null && vm.versionWarning.get() !== '',
    'versionWarning is set when versioned file is missing'
  );
  assert.equal(logged.length, 1, 'the failed freeze is logged once');
  assert.match(String(logged[0]), /sha256:abc123/);
  // The console is shared with SharePoint's own noise; the prefix is how an
  // operator filters to us, and this line exists to be found.
  assert.match(String(logged[0]), /^\[CORA\] /);
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
  // No live Case Type declares a sectionLabels override (stress-review, which
  // did, was retired in #383). Register a fixture importer that carries the
  // demonstrative { questions: 'Assessment' } override for this test.
  const slug = 'section-labels-fixture';
  CASE_TYPE_IMPORTERS[slug] = async () => ({
    default: /** @type {any} */ ({
      displayName: 'Section Labels Fixture',
      listName: 'Cases-SectionLabelsFixture',
      sectionLabels: { questions: 'Assessment' },
      questions: [],
      computeOutcome: () => ({ outcome: 'pass' }),
      outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
      defaultOutcomeId: 'pass',
    }),
  });

  try {
    const vm = makeLabelsVM(slug);
    await vm.load();
    assert.equal(vm.sectionLabels.questions, 'Assessment');
    assert.equal(vm.sectionHeadings.questions, 'Assessment');
    // Every other Section keeps the defaults.
    assert.equal(vm.sectionLabels.notes, 'Notes');
    assert.equal(vm.sectionHeadings.remediation, 'Remediation');
  } finally {
    delete CASE_TYPE_IMPORTERS[slug];
  }
});

test('CaseReviewViewModel.load(): a pre-#390 versioned export maps its category to questionGroup', async () => {
  // Exports published before the two-level grouping rename carry no
  // `questionGroup` key, and their `category` meant the inner grouping.
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
            category: 'Context',
            responseType: 'yes-no-na',
            options: null,
            showWhen: null,
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

  assert.equal(vm.catalogue[0].questionGroup, 'Context');
  assert.equal(vm.catalogue[0].category, undefined);
});

test('CaseReviewViewModel.load(): a #390 versioned export keeps category and questionGroup distinct', async () => {
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
            category: 'COGG A',
            questionGroup: 'Acknowledgement',
            responseType: 'yes-no-na',
            options: null,
            showWhen: null,
            deprecated: false,
          },
          {
            id: 'q2',
            text: 'T2',
            category: null,
            questionGroup: null,
            responseType: 'yes-no-na',
            options: null,
            showWhen: null,
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

  assert.equal(vm.catalogue[0].category, 'COGG A');
  assert.equal(vm.catalogue[0].questionGroup, 'Acknowledgement');
  assert.equal(vm.catalogue[1].category, undefined);
  assert.equal(vm.catalogue[1].questionGroup, undefined);
});
