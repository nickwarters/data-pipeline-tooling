// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CASE_TYPE_IMPORTERS,
  registerCaseType,
} from '../case-types/manifest.js';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';
import { makeLoader } from './helpers/case-loader.js';
import { caps } from './helpers/section-access.js';
import { makeCaseRow } from './helpers/fixtures.js';

isolateBrowserGlobals();

let fixtureSequence = 0;

/**
 * @param {import('node:test').TestContext} t
 * @param {string} prefix
 * @param {() => Promise<any>} importer
 */
function registerFixtureCaseType(t, prefix, importer) {
  const slug = `${prefix}-${++fixtureSequence}`;
  const previous = CASE_TYPE_IMPORTERS[slug];
  CASE_TYPE_IMPORTERS[slug] = importer;
  t.after(() => {
    if (previous === undefined) delete CASE_TYPE_IMPORTERS[slug];
    else CASE_TYPE_IMPORTERS[slug] = previous;
  });
  return slug;
}

test('toStoreSnapshot: an empty multi-choice Answer is unanswered on load', () => {
  const loader = makeLoader();
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
  const loader = makeLoader();
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

// --- exportHash loading ---

test('CaseLoader.load() calls getExportHash with the case type slug and stores it as exportHash', async () => {
  const loader = makeLoader({
    client: {
      getExportHash: async (/** @type {string} */ slug) =>
        slug === 'example-review' ? 'sha256:testHash' : null,
    },
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
  const row = makeCaseRow({
    id: 'c1',
    caseType: 'example-review',
    title: 'T',
    assignedReviewer: 'u1',
    responsibleParty: 'u2',
    etag: 'e1',
  });
  const loader = makeLoader({
    client: {
      getCase: async (
        /** @type {string} */ id,
        /** @type {import('../src/sharepoint-client.js').CaseListOptions | undefined} */ opts
      ) => {
        getCaseCalls.push({ id, opts });
        return row;
      },
    },
    saveQueue: {
      loadCase: (
        /** @type {import('../src/sharepoint-client.js').CaseRow} */ row,
        /** @type {import('../src/sharepoint-client.js').CaseListOptions | undefined} */ opts
      ) => loadCaseCalls.push([row, opts]),
    },
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
  const loader = makeLoader();

  await loader.load();

  assert.equal(loader.exportHash, null);
});

// --- versioned catalogue loading ---

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
  const loader = makeLoader({
    row: {
      status: 'Completed',
      completedAt: '2026-01-01T00:00:00Z',
      questionBankVersion: 'sha256:abc123',
      answers: { 'q-welcome': { value: 'Yes' } },
    },
    client: {
      getVersionedExport: async () => ({
        slug: 'example-review',
        questions: versionedCatalogue,
      }),
    },
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
  const loader = makeLoader({
    row: {
      status: 'Actions In Progress',
      questionBankVersion: 'sha256:abc123',
      answers: { 'q-welcome': { value: 'Yes' } },
    },
    client: {
      getVersionedExport: async () => ({
        slug: 'example-review',
        questions: versionedCatalogue,
      }),
    },
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

test('CaseLoader.load(): a Case voided after the reportable milestone keeps its stamped bank', async () => {
  // Void is terminal but not reportable, so asking the reportable predicate
  // would drop a stamped snapshot back onto the live bank and re-render frozen
  // Answers against Questions that have since moved.
  /** @type {any[]} */
  const versionedExportCalls = [];
  const loader = makeLoader({
    row: {
      status: 'Void',
      reportableAt: '2026-01-01T00:00:00Z',
      questionBankVersion: 'sha256:abc123',
      answers: { 'q-welcome': { value: 'Yes' } },
    },
    client: {
      getVersionedExport: async (
        /** @type {string} */ slug,
        /** @type {string} */ hash
      ) => {
        versionedExportCalls.push([slug, hash]);
        return { slug: 'example-review', questions: versionedCatalogue };
      },
    },
  });

  await loader.load();

  assert.deepEqual(versionedExportCalls, [['example-review', 'sha256:abc123']]);
  assert.deepEqual(
    loader.catalogue.map((q) => q.id),
    ['q-old']
  );
});

test('CaseLoader.load(): a Case voided before the reportable milestone reads the live bank', async () => {
  /** @type {any[]} */
  const versionedExportCalls = [];
  const loader = makeLoader({
    row: {
      status: 'Void',
      questionBankVersion: 'sha256:abc123',
      answers: { 'q-welcome': { value: 'Yes' } },
    },
    client: {
      getVersionedExport: async (
        /** @type {string} */ slug,
        /** @type {string} */ hash
      ) => {
        versionedExportCalls.push([slug, hash]);
        return { slug: 'example-review', questions: versionedCatalogue };
      },
    },
  });

  await loader.load();

  assert.deepEqual(versionedExportCalls, [], 'nothing was ever frozen');
});

test('CaseLoader.load(): versioned catalogue mapping normalises null optional fields to undefined', async () => {
  const loader = makeLoader({
    row: {
      status: 'Completed',
      completedAt: '2026-01-01T00:00:00Z',
      questionBankVersion: 'sha256:abc123',
      answers: { 'q-welcome': { value: 'Yes' } },
    },
    client: {
      getVersionedExport: async () => ({
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
      }),
    },
  });

  await loader.load();

  const q = loader.catalogue[0];
  assert.equal(q.category, undefined);
  assert.equal(q.options, undefined);
  assert.equal(q.showWhen, undefined);
  assert.equal('failureCriteria' in q, false);
});

test('CaseLoader.load(): live catalogue derives failureValues from the config outcome mapping', async () => {
  const loader = makeLoader({
    row: { answers: { 'q-welcome': { value: 'Yes' } } },
  });

  await loader.load();

  const q = loader.catalogue.find((x) => x.id === 'q-welcome');
  assert.deepEqual(q?.failureValues, ['No']);
});

test('CaseLoader.load(): frozen catalogue derives failureValues against the snapshot default Outcome', async () => {
  const loader = makeLoader({
    row: {
      status: 'Completed',
      completedAt: '2026-01-01T00:00:00Z',
      questionBankVersion: 'sha256:abc123',
      answers: { 'q-welcome': { value: 'Yes' } },
    },
    client: {
      getVersionedExport: async () => ({
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
      }),
    },
  });

  await loader.load();

  assert.deepEqual(loader.catalogue[0].failureValues, ['No']);
});

test('CaseLoader.load(): versioned catalogue carries labelIds when present', async () => {
  const loader = makeLoader({
    row: {
      status: 'Completed',
      completedAt: '2026-01-01T00:00:00Z',
      questionBankVersion: 'sha256:abc123',
      answers: { 'q-welcome': { value: 'Yes' } },
    },
    client: {
      getVersionedExport: async () => ({
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
      }),
    },
  });

  await loader.load();

  assert.deepEqual(loader.catalogue[0].labelIds, ['lbl-a']);
});

test('CaseLoader.load(): missing versioned file falls back to live catalogue + versionWarning', async () => {
  const loader = makeLoader({
    row: {
      status: 'Completed',
      completedAt: '2026-01-01T00:00:00Z',
      questionBankVersion: 'sha256:abc123',
      answers: { 'q-welcome': { value: 'Yes' } },
    },
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
  const loader = makeLoader({
    row: {
      status: 'In-progress',
      answers: { 'q-welcome': { value: 'Yes' } },
    },
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
  const loader = makeLoader({
    row: {
      status: 'Completed',
      completedAt: '2026-01-01T00:00:00Z',
      questionBankVersion: undefined,
      answers: { 'q-welcome': { value: 'Yes' } },
    },
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

test('CaseLoader: sectionLabels default before load()', () => {
  const loader = makeLoader();
  assert.equal(loader.sectionLabels.questions.tab, 'Review');
  assert.equal(loader.sectionLabels.questions.heading, 'Questions');
  assert.equal(loader.sectionLabels.details.heading, 'Case Details');
  assert.equal(loader.sectionLabels.notes.tab, 'Notes');
});

test('CaseLoader.load(): a Case Type without sectionLabels keeps the defaults', async () => {
  const loader = makeLoader();
  await loader.load();
  assert.equal(loader.sectionLabels.questions.tab, 'Review');
  assert.equal(loader.sectionLabels.questions.heading, 'Questions');
  assert.equal(loader.sectionLabels.details.heading, 'Case Details');
  assert.equal(loader.sectionLabels.appealReview.tab, 'Appeal Review');
});

/**
 * Register a fixture Case Type carrying `sectionLabels`, run `load()`, and
 * hand the resolved copy back. No live Case Type declares an override
 * (stress-review, which did, has been retired).
 *
 * @param {import('node:test').TestContext} t
 * @param {any} sectionLabels
 */
async function loadWithSectionLabels(t, sectionLabels) {
  const slug = registerFixtureCaseType(
    t,
    'section-labels-fixture',
    async () => ({
      default: /** @type {any} */ ({
        displayName: 'Section Labels Fixture',
        listName: 'Cases-SectionLabelsFixture',
        sectionLabels,
        questions: [],
        computeOutcome: () => ({ outcome: 'pass' }),
        outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
        defaultOutcomeId: 'pass',
      }),
    })
  );

  const loader = makeLoader({ row: { caseType: slug } });
  await loader.load();
  return loader.sectionLabels;
}

test('CaseLoader.load(): a string override renames both the tab and the heading', async (t) => {
  const labels = await loadWithSectionLabels(t, { questions: 'Assessment' });

  assert.equal(labels.questions.tab, 'Assessment');
  assert.equal(labels.questions.heading, 'Assessment');
  // Every other Section keeps the defaults.
  assert.equal(labels.notes.tab, 'Notes');
  assert.equal(labels.remediation.heading, 'Remediation');
});

test('CaseLoader.load(): an object override renames only the axis it names', async (t) => {
  const labels = await loadWithSectionLabels(t, {
    questions: { tab: 'Assess' },
  });

  assert.equal(labels.questions.tab, 'Assess');
  assert.equal(labels.questions.heading, 'Questions');
});

test('CaseLoader.load(): a Summary role list narrows the blocks, and access still bounds it', async (t) => {
  // No live Case Type scopes a Summary block to fewer roles than can see the
  // Section, so register a fixture that does: Issues is composed for the
  // reviewer side plus Controls, and Questions names the Responsible Party —
  // who the access matrix hides Questions from entirely.
  const slug = registerFixtureCaseType(
    t,
    'summary-roles-fixture',
    async () => ({
      default: /** @type {any} */ ({
        displayName: 'Summary Roles Fixture',
        listName: 'Cases-SummaryRolesFixture',
        sections: {
          details: {},
          questions: { showInSummary: ['responsibleParty'] },
          issues: {
            showInSummary: [
              'assignedReviewer',
              'otherReviewer',
              'reviewerManager',
              'caseTypeOwner',
              'journeyOwner',
              'controls',
            ],
          },
          summary: {},
          // Keeps the Responsible Party out of the whole-page access-denied path,
          // so their empty Summary is a resolved answer and not an early return.
          conversation: {},
        },
        questions: [],
        computeOutcome: () => ({ outcome: 'pass' }),
        outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
        defaultOutcomeId: 'pass',
      }),
    })
  );

  /**
   * @param {string} userId
   * @param {import('../src/services/permissions.js').Capabilities} capabilities
   */
  const loadAs = async (userId, capabilities) => {
    const loader = makeLoader({
      row: { caseType: slug },
      currentUserId: userId,
      capabilities,
    });
    await loader.load();
    return loader;
  };

  // Controls holds a role the Issues list names, so that block is composed;
  // Questions, which names only the Responsible Party, is not.
  const controls = await loadAs('u9', caps({ isControls: true }));
  assert.deepEqual(controls.summarySections, ['details', 'issues']);

  // The Responsible Party is named on the Questions list, but the matrix
  // hides Questions from them — the list narrows and never widens.
  const responsibleParty = await loadAs('u2', caps());
  assert.equal(responsibleParty.accessDenied, false);
  assert.deepEqual(responsibleParty.summarySections, []);
});

test('CaseLoader.load(): a pre-rename versioned export maps its category to questionGroup', async () => {
  // Exports published before the two-level grouping rename carry no
  // `questionGroup` key, and their `category` meant the inner grouping.
  const loader = makeLoader({
    row: {
      status: 'Completed',
      completedAt: '2026-01-01T00:00:00Z',
      questionBankVersion: 'sha256:abc123',
      answers: { 'q-welcome': { value: 'Yes' } },
    },
    client: {
      getVersionedExport: async () => ({
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
      }),
    },
  });

  await loader.load();

  assert.equal(loader.catalogue[0].questionGroup, 'Context');
  assert.equal(loader.catalogue[0].category, undefined);
});

test('CaseLoader.load(): a post-rename versioned export keeps category and questionGroup distinct', async () => {
  const loader = makeLoader({
    row: {
      status: 'Completed',
      completedAt: '2026-01-01T00:00:00Z',
      questionBankVersion: 'sha256:abc123',
      answers: { 'q-welcome': { value: 'Yes' } },
    },
    client: {
      getVersionedExport: async () => ({
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
      }),
    },
  });

  await loader.load();

  assert.equal(loader.catalogue[0].category, 'COGG A');
  assert.equal(loader.catalogue[0].questionGroup, 'Acknowledgement');
  assert.equal(loader.catalogue[1].category, undefined);
  assert.equal(loader.catalogue[1].questionGroup, undefined);
});

// A Case Type whose capture groups declare a person field beside a text one:
// the display-name refresh must tell them apart from the config alone.
registerCaseType({
  slug: 'person-capture-review',
  displayName: 'Person Capture Review',
  importer: async () => ({
    default: {
      listName: 'Cases-PersonCaptureReview',
      questions: [
        {
          id: 'q-needs',
          text: 'Needs identified?',
          responseType: 'yes-no-na',
          deprecated: false,
        },
      ],
      computeOutcome: () => ({ outcome: 'fail' }),
      outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
      defaultOutcomeId: 'pass',
      captureGroups: [
        {
          key: 'blame',
          label: 'Blame',
          fields: [
            { key: 'attributedTo', label: 'Attributed to', type: 'person' },
            { key: 'raisedBy', label: 'Raised by', type: 'person' },
            { key: 'rootCause', label: 'Root cause', type: 'text' },
          ],
        },
      ],
    },
  }),
});

test('CaseLoader.load() refreshes person capture display names in one directory call', async () => {
  /** @type {string[][]} */
  const resolveCalls = [];
  /** @type {any[]} */
  const patches = [];
  const answers = {
    'q-needs': {
      value: 'No',
      // Two person Issue Capture Fields, both holding a name the directory has
      // since changed.
      capture: {
        attributedTo: { loginName: 'bjones', displayName: 'B. Jones' },
        raisedBy: { loginName: 'jsmith', displayName: 'J. Smith' },
        rootCause: 'jsmith',
      },
    },
  };
  const loader = makeLoader({
    row: { caseType: 'person-capture-review', answers },
    client: {
      resolveUsers: async (/** @type {string[]} */ accounts) => {
        resolveCalls.push(accounts);
        return { jsmith: 'Jane Smith', bjones: 'Bob Jones' };
      },
      patchCase: async (/** @type {any} */ ...args) => {
        patches.push(args);
        return { ok: true, status: 200 };
      },
    },
    caseType: 'person-capture-review',
  });

  await loader.load();

  assert.equal(resolveCalls.length, 1, 'one batched directory call');
  assert.deepEqual(resolveCalls[0].sort(), ['bjones', 'jsmith']);
  const loaded = loader.answers['q-needs'];
  assert.deepEqual(loaded.capture?.raisedBy, {
    loginName: 'jsmith',
    displayName: 'Jane Smith',
  });
  assert.deepEqual(loaded.capture?.attributedTo, {
    loginName: 'bjones',
    displayName: 'Bob Jones',
  });
  assert.equal(
    loaded.capture?.rootCause,
    'jsmith',
    'a non-person capture value is left alone whatever it looks like'
  );
  assert.equal(patches.length, 0, 'a display-name refresh is never persisted');
});
