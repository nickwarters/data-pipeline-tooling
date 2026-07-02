// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

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
    'example-review',
    'product-sale-review',
    'qa-example-review',
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
        'example-review,product-sale-review,qa-example-review,stress-review' &&
      error.message ===
        `Unsupported Case Type slug "${slug}". Known Case Type slugs: example-review, product-sale-review, qa-example-review, stress-review.`
  );
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
      'example-review',
      'product-sale-review',
      'qa-example-review',
      'stress-review',
    ]);
  } finally {
    console.error = originalConsoleError;
  }
});

test('CaseReviewViewModel._resolveSourceCase(): unknown QA source Case Type slug follows the same error path', async () => {
  /** @type {any[]} */
  const errors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => errors.push(args);

  try {
    const vm = new CaseReviewViewModel({
      client: /** @type {any} */ ({
        getCase: async (/** @type {string} */ id) =>
          id === 'source-1'
            ? {
                id: 'source-1',
                caseType: '../unexpected-source',
                title: 'Source',
                status: 'Completed',
                assignedReviewer: 'u1',
                responsibleParty: 'u2',
                answers: {},
                conversation: [],
                notes: '',
                completedAt: '2026-01-01T00:00:00Z',
                etag: 'source-etag',
              }
            : {
                id: 'qa-1',
                caseType: 'qa-example-review',
                title: 'QA',
                status: 'In-progress',
                assignedReviewer: 'u1',
                responsibleParty: '',
                sourceCaseId: 'source-1',
                answers: {},
                conversation: [],
                notes: '',
                completedAt: null,
                etag: 'qa-etag',
              },
        getCurrentUser: async () => ({ id: 'u1', displayName: 'User 1' }),
        getExportHash: async () => null,
        resolveUsers: async () => ({}),
      }),
      saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
      caseId: 'qa-1',
      currentUserId: 'u1',
      capabilities: {
        isReviewer: true,
        ownedCaseTypes: [],
        isAdviser: false,
        isReviewerManager: false,
        isResponsiblePartyManager: false,
        isMaintainer: false,
        listAccessCaseTypes: [],
        ownedJourneyCaseTypes: [],
        isControls: true,
        isVisitor: false,
      },
    });

    await vm.load();

    assert.equal(
      vm.error.get(),
      'This Case cannot be opened because its source Case Type is not supported. Ask a maintainer to add "../unexpected-source" to the Case Type manifest.'
    );
    assert.equal(vm.loaded.get(), false);
    assert.equal(vm.sourceCase, null);
    assert.equal(errors.length, 1);
    assert.ok(errors[0][0] instanceof UnknownCaseTypeError);
    assert.equal(errors[0][0].slug, '../unexpected-source');
    assert.deepEqual(errors[0][0].knownSlugs, [
      'example-review',
      'product-sale-review',
      'qa-example-review',
      'stress-review',
    ]);
  } finally {
    console.error = originalConsoleError;
  }
});
