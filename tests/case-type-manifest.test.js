// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CASE_TYPE_IMPORTERS,
  UnknownCaseTypeError,
  loadCaseTypeConfig,
} from '../case-types/manifest.js';

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
      error.message === `Unknown Case Type slug "${slug}".`
  );
});

test.todo(
  'CaseReviewViewModel.load(): unknown primary Case Type slug sets a clear user-facing error state'
);

test.todo(
  'CaseReviewViewModel._resolveSourceCase(): unknown QA source Case Type slug follows the same error path'
);
