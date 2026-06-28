// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CASE_TYPE_IMPORTERS,
  UnknownCaseTypeError,
  loadCaseTypeConfig,
} from '../case-types/manifest.js';

test('case type manifest: known Case Type slugs resolve to their static import functions', async () => {
  assert.deepEqual(Object.keys(CASE_TYPE_IMPORTERS).sort(), [
    'example-review',
    'product-sale-review',
    'qa-example-review',
    'stress-review',
  ]);

  const config = await loadCaseTypeConfig('example-review');
  assert.deepEqual(config.eligibleGroups, ['Reviewers']);
  assert.ok(Array.isArray(config.questions));
});

test('case type manifest: unknown Case Type slugs reject with a developer-useful error', async () => {
  await assert.rejects(
    loadCaseTypeConfig('../unexpected'),
    (error) =>
      error instanceof UnknownCaseTypeError &&
      error.name === 'UnknownCaseTypeError' &&
      error.slug === '../unexpected' &&
      error.message.includes('Unknown Case Type slug "../unexpected".')
  );
});

test.todo(
  'CaseReviewViewModel.load(): unknown primary Case Type slug sets a clear user-facing error state'
);

test.todo(
  'CaseReviewViewModel._resolveSourceCase(): unknown QA source Case Type slug follows the same error path'
);
