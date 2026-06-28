// @ts-check
import { test } from 'node:test';

test.todo(
  'case type manifest: known Case Type slugs resolve to their static import functions'
);

test.todo(
  'case type manifest: unknown Case Type slugs reject with a developer-useful error'
);

test.todo(
  'CaseReviewViewModel.load(): unknown primary Case Type slug sets a clear user-facing error state'
);

test.todo(
  'CaseReviewViewModel._resolveSourceCase(): unknown QA source Case Type slug follows the same error path'
);
