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
