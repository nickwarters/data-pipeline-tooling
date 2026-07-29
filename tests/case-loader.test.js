// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaseLoader } from '../src/lib/case-loader.js';
import { CASE_TYPE_IMPORTERS } from '../case-types/manifest.js';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';

isolateBrowserGlobals();

test('the loader holds its loading state as plain fields, not signals', () => {
  const loader = new CaseLoader({
    client: /** @type {any} */ ({}),
    saveQueue: /** @type {any} */ ({ enqueue() {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });

  const snapshot = loader.toStoreSnapshot();
  assert.equal(snapshot.loaded, false);
  assert.equal(snapshot.error, null);
  assert.equal(snapshot.accessDenied, false);

  // The snapshot is the public seam and proves the handover is unchanged, but
  // it cannot on its own prove the conversion: `toStoreSnapshot()` read the
  // same values through `.get()` before. One structural assertion carries the
  // ticket's actual claim — the loading state is no longer a notifier.
  for (const field of ['loaded', 'error', 'accessDenied', 'versionWarning']) {
    const value = /** @type {Record<string, any>} */ (
      /** @type {unknown} */ (loader)
    )[field];
    assert.equal(
      typeof (value ?? {}).get,
      'undefined',
      `${field} must be a plain field, not a signal`
    );
  }
});

test('toStoreSnapshot: an empty multi-choice Answer is unanswered on load', () => {
  const loader = new CaseLoader({
    client: /** @type {any} */ ({}),
    saveQueue: /** @type {any} */ ({ enqueue() {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });
  loader.catalogue = [
    {
      id: 'q1',
      text: 'Select every applicable issue',
      responseType: 'multi-choice',
      options: ['Issue A'],
      deprecated: false,
    },
  ];
  loader.answers = { q1: { value: [] } };

  assert.equal(loader.toStoreSnapshot().allAnswered, false);
});

test('toStoreSnapshot: the loader hands over Answers and the derived applicable set', () => {
  const loader = new CaseLoader({
    client: /** @type {any} */ ({}),
    saveQueue: /** @type {any} */ ({ enqueue() {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });
  loader.catalogue = [
    { id: 'q1', text: 'One', responseType: 'yes-no-na', deprecated: false },
    {
      id: 'q2',
      text: 'Only when q1 is No',
      responseType: 'yes-no-na',
      showWhen: { q1: { equals: 'No' } },
      deprecated: false,
    },
  ];
  loader.answers = { q1: { value: 'Yes' } };

  const snapshot = loader.toStoreSnapshot();
  assert.equal(snapshot.answers, loader.answers);
  assert.deepEqual(
    snapshot.applicableQuestions.map((q) => q.id),
    ['q1']
  );
});

test('CaseLoader exposes no Answer mutation surface', () => {
  // The store is the single Answer owner: the loader loads, and the route's
  // answer-actions are the only writers.
  const loader = new CaseLoader({
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
      typeof (/** @type {any} */ (loader)[name]),
      'undefined',
      `${name} must not exist on the loader`
    );
  }
  assert.equal('answersSignal' in loader, false);
});

// --- exportHash loading ---

test('CaseLoader.load() calls getExportHash with the case type slug and stores it as exportHash', async () => {
  const loader = new CaseLoader({
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

  await loader.load();

  assert.equal(
    loader.exportHash,
    'sha256:testHash',
    'exportHash is stored from getExportHash result'
  );
});

test('CaseLoader.load() resolves route caseType to listName for getCase and SaveQueue', async () => {
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
  const loader = new CaseLoader({
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

  await loader.load();

  assert.deepEqual(getCaseCalls[0], {
    id: 'c1',
    opts: { listName: 'Cases-ExampleReview' },
  });
  assert.deepEqual(loadCaseCalls[0], [
    row,
    { listName: 'Cases-ExampleReview' },
  ]);
  assert.deepEqual(loader.caseListOptions, { listName: 'Cases-ExampleReview' });
});

test('CaseLoader.load() stores null exportHash when getExportHash returns null', async () => {
  const loader = new CaseLoader({
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

  await loader.load();

  assert.equal(loader.exportHash, null);
});

// --- versioned catalogue loading ---

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

test('CaseLoader.load() uses versioned catalogue for Completed Case with questionBankVersion', async () => {
  const loader = new CaseLoader({
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

  await loader.load();

  assert.equal(
    loader.catalogue.length,
    1,
    'only non-deprecated versioned questions'
  );
  assert.equal(loader.catalogue[0].id, 'q-old', 'id from versioned file');
  assert.equal(
    loader.catalogue[0].text,
    'A question from version time',
    'text from versioned file'
  );
});

test('CaseLoader.load(): Actions In Progress Case freezes on the versioned catalogue — no reopen once reportable', async () => {
  const loader = new CaseLoader({
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

  await loader.load();

  // The reportable milestone freezes the bank as-reviewed: an
  // 'Actions In Progress' Case loads the versioned snapshot exactly like a
  // Completed one, so a Question added to the live bank cannot reopen it.
  const ids = new Set(loader.catalogue.map((q) => q.id));
  assert.deepEqual([...ids], ['q-old'], 'frozen to the as-reviewed snapshot');
  assert.ok(
    !ids.has('q-welcome'),
    'a live-bank Question does not reopen a reportable Case'
  );
  assert.equal(
    loader.toStoreSnapshot().versionWarning,
    null,
    'snapshot resolved, no warning'
  );
});

test('CaseLoader.load(): versioned catalogue mapping normalises null optional fields to undefined', async () => {
  const loader = new CaseLoader({
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

  await loader.load();

  const q = loader.catalogue[0];
  assert.equal(q.category, undefined);
  assert.equal(q.options, undefined);
  assert.equal(q.showWhen, undefined);
  assert.equal('failureCriteria' in q, false);
});

test('CaseLoader.load(): live catalogue derives failureValues from the config outcome mapping', async () => {
  const loader = new CaseLoader({
    client: makeStep4Client(),
    saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });

  await loader.load();

  const q = loader.catalogue.find((x) => x.id === 'q-welcome');
  assert.deepEqual(q?.failureValues, ['No']);
});

test('CaseLoader.load(): frozen catalogue derives failureValues against the snapshot default Outcome', async () => {
  const loader = new CaseLoader({
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
        // The snapshot carries its own vocabulary, and that vocabulary — not
        // the live Case Type's — governs the as-reviewed failure semantics.
        defaultOutcomeId: 'good',
      },
    }),
    saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });

  await loader.load();

  assert.deepEqual(loader.catalogue[0].failureValues, ['No']);
});

test('CaseLoader.load(): versioned catalogue carries labelIds when present', async () => {
  const loader = new CaseLoader({
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

  await loader.load();

  assert.deepEqual(loader.catalogue[0].labelIds, ['lbl-a']);
});

test('CaseLoader.load(): missing versioned file falls back to live catalogue + versionWarning', async () => {
  const loader = new CaseLoader({
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
  // reaches whoever opens the Case. The log is the operator's copy.
  const originalError = console.error;
  /** @type {unknown[]} */
  const logged = [];
  console.error = (/** @type {unknown} */ message) => logged.push(message);
  try {
    await loader.load();
  } finally {
    console.error = originalError;
  }

  const liveIds = new Set(loader.catalogue.map((q) => q.id));
  assert.ok(liveIds.has('q-welcome'), 'falls back to live bank');
  assert.ok(
    !!loader.toStoreSnapshot().versionWarning,
    'versionWarning is set when versioned file is missing'
  );
  assert.equal(logged.length, 1, 'the failed freeze is logged once');
  assert.match(String(logged[0]), /sha256:abc123/);
  // The console is shared with SharePoint's own noise; the prefix is how an
  // operator filters to us, and this line exists to be found.
  assert.match(String(logged[0]), /^\[CORA\] /);
});

test('CaseLoader.load(): In-progress Case loads live catalogue; versionWarning stays null', async () => {
  const loader = new CaseLoader({
    client: makeStep4Client({ status: 'In-progress' }),
    saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });

  await loader.load();

  const liveIds = new Set(loader.catalogue.map((q) => q.id));
  assert.ok(liveIds.has('q-welcome'), 'live bank loaded');
  assert.equal(
    loader.toStoreSnapshot().versionWarning,
    null,
    'no warning for in-progress case'
  );
});

test('CaseLoader.load(): Completed Case without questionBankVersion falls back to live (backward compat)', async () => {
  const loader = new CaseLoader({
    client: makeStep4Client({
      status: 'Completed',
      questionBankVersion: undefined,
    }),
    saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: null,
  });

  await loader.load();

  const liveIds = new Set(loader.catalogue.map((q) => q.id));
  assert.ok(liveIds.has('q-welcome'), 'legacy: live bank loaded');
  assert.equal(
    loader.toStoreSnapshot().versionWarning,
    null,
    'no warning for legacy cases'
  );
});

// --- Case Type sectionLabels resolution ---

/** @param {string} caseType */
function makeLabelsLoader(caseType) {
  return new CaseLoader({
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

test('CaseLoader: sectionLabels/sectionHeadings default before load()', () => {
  const loader = makeLabelsLoader('example-review');
  assert.equal(loader.sectionLabels.questions, 'Review');
  assert.equal(loader.sectionHeadings.questions, 'Questions');
  assert.equal(loader.sectionLabels.notes, 'Notes');
});

test('CaseLoader.load(): a Case Type without sectionLabels keeps the defaults', async () => {
  const loader = makeLabelsLoader('example-review');
  await loader.load();
  assert.equal(loader.sectionLabels.questions, 'Review');
  assert.equal(loader.sectionHeadings.questions, 'Questions');
  assert.equal(loader.sectionLabels.appealReview, 'Appeal Review');
});

test('CaseLoader.load(): resolves a Case Type sectionLabels override into labels and headings', async () => {
  // No live Case Type declares a sectionLabels override (stress-review, which
  // did, has been retired). Register a fixture importer that carries the
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
    const loader = makeLabelsLoader(slug);
    await loader.load();
    assert.equal(loader.sectionLabels.questions, 'Assessment');
    assert.equal(loader.sectionHeadings.questions, 'Assessment');
    // Every other Section keeps the defaults.
    assert.equal(loader.sectionLabels.notes, 'Notes');
    assert.equal(loader.sectionHeadings.remediation, 'Remediation');
  } finally {
    delete CASE_TYPE_IMPORTERS[slug];
  }
});

test('CaseLoader.load(): a pre-rename versioned export maps its category to questionGroup', async () => {
  // Exports published before the two-level grouping rename carry no
  // `questionGroup` key, and their `category` meant the inner grouping.
  const loader = new CaseLoader({
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

  await loader.load();

  assert.equal(loader.catalogue[0].questionGroup, 'Context');
  assert.equal(loader.catalogue[0].category, undefined);
});

test('CaseLoader.load(): a post-rename versioned export keeps category and questionGroup distinct', async () => {
  const loader = new CaseLoader({
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

  await loader.load();

  assert.equal(loader.catalogue[0].category, 'COGG A');
  assert.equal(loader.catalogue[0].questionGroup, 'Acknowledgement');
  assert.equal(loader.catalogue[1].category, undefined);
  assert.equal(loader.catalogue[1].questionGroup, undefined);
});
