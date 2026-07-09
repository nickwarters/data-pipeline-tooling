// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CASE_TYPE_IMPORTERS,
  UnknownCaseTypeError,
  loadCaseTypeConfig,
} from '../case-types/manifest.js';
import { CaseReviewViewModel } from '../src/lib/case-review-view-model.js';

test('case type manifest: known Case Type slugs resolve to their static import functions', async () => {
  const knownSlugs = [
    'complaints',
    'example-review',
    'product-sale-review',
    'stress-review',
  ];
  assert.deepEqual(Object.keys(CASE_TYPE_IMPORTERS).sort(), knownSlugs);

  for (const slug of knownSlugs) {
    assert.equal(typeof CASE_TYPE_IMPORTERS[slug], 'function');
    const config = await loadCaseTypeConfig(slug);
    assert.ok(Array.isArray(config.questions), `${slug} has questions`);
  }
});

test('case type manifest: unknown Case Type slugs reject with a developer-useful error', async () => {
  const slug = '../unexpected';

  await assert.rejects(
    loadCaseTypeConfig(slug),
    (error) =>
      error instanceof UnknownCaseTypeError &&
      error.name === 'UnknownCaseTypeError' &&
      error.slug === slug &&
      error.knownSlugs.join(',') ===
        'complaints,example-review,product-sale-review,stress-review' &&
      error.message ===
        `Unsupported Case Type slug "${slug}". Known Case Type slugs: complaints, example-review, product-sale-review, stress-review.`
  );
});

test('case type manifest: rejects invalid outcome configuration before a Case Type is used', async () => {
  const baseConfig = {
    questions: [],
    computeOutcome: () => ({ outcome: 'pass' }),
    outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
    defaultOutcomeId: 'pass',
  };
  const cases = [
    {
      config: { ...baseConfig, questions: undefined },
      message: /Case Type "invalid".*questions must be an array/,
    },
    {
      config: { ...baseConfig, outcomeOptions: [] },
      message: /Case Type "invalid".*outcomeOptions/,
    },
    {
      config: { ...baseConfig, defaultOutcomeId: 'ghost' },
      message: /Case Type "invalid".*defaultOutcomeId "ghost"/,
    },
    {
      config: {
        ...baseConfig,
        outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: NaN }],
      },
      message: /Case Type "invalid".*severity/,
    },
    {
      config: {
        ...baseConfig,
        outcomeOptions: [
          { id: 'pass', wording: 'Pass', severity: 0 },
          { id: 'pass', wording: 'Another pass', severity: 50 },
        ],
      },
      message: /Case Type "invalid".*duplicate outcome id "pass"/,
    },
    {
      config: {
        ...baseConfig,
        questions: [
          {
            id: 'q1',
            text: 'Q1',
            responseType: 'single-choice',
            optionOutcomes: { No: 'ghost' },
            deprecated: false,
          },
        ],
      },
      message: /Case Type "invalid".*unknown outcome id "ghost"/,
    },
  ];

  for (const { config, message } of cases) {
    await assert.rejects(
      loadCaseTypeConfig('invalid', {
        invalid: async () => ({ default: /** @type {any} */ (config) }),
      }),
      message
    );
  }
});

test('CaseReviewViewModel.load(): unknown primary Case Type slug sets a clear user-facing error state', async () => {
  /** @type {any[]} */
  const errors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => errors.push(args);

  try {
    const vm = new CaseReviewViewModel({
      client: /** @type {any} */ ({
        getCase: async () => ({
          id: 'c1',
          caseType: '../unexpected',
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

    assert.equal(
      vm.error.get(),
      'This Case cannot be opened because its Case Type is not supported. Ask a maintainer to add "../unexpected" to the Case Type manifest.'
    );
    assert.equal(vm.loaded.get(), false);
    assert.equal(vm.config, null);
    assert.equal(errors.length, 1);
    assert.ok(errors[0][0] instanceof UnknownCaseTypeError);
    assert.equal(errors[0][0].slug, '../unexpected');
    assert.deepEqual(errors[0][0].knownSlugs, [
      'complaints',
      'example-review',
      'product-sale-review',
      'stress-review',
    ]);
  } finally {
    console.error = originalConsoleError;
  }
});

test('CaseReviewViewModel.load(): invalid Case Type outcome configuration sets a clear user-facing error state', async () => {
  const slug = 'invalid-outcome-config';
  const originalConsoleError = console.error;
  console.error = () => {};
  CASE_TYPE_IMPORTERS[slug] = async () => ({
    default: /** @type {any} */ ({
      questions: [],
      computeOutcome: () => ({ outcome: 'pass' }),
      outcomeOptions: [],
      defaultOutcomeId: 'pass',
    }),
  });

  try {
    const vm = new CaseReviewViewModel({
      client: /** @type {any} */ ({
        getCase: async () => null,
        getCurrentUser: async () => ({ id: 'u1', displayName: 'User 1' }),
      }),
      saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
      caseId: 'c1',
      currentUserId: 'u1',
      capabilities: null,
      caseType: slug,
    });

    await vm.load();

    assert.equal(
      vm.error.get(),
      'This Case cannot be opened because its Case Type outcome configuration is invalid. Ask a maintainer to correct it.'
    );
    assert.equal(vm.loaded.get(), false);
    assert.equal(vm.config, null);
  } finally {
    delete CASE_TYPE_IMPORTERS[slug];
    console.error = originalConsoleError;
  }
});
