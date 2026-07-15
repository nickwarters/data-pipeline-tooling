// @ts-check
// Seeds the bank-editor store with the `example-review` test fixture bank.
//
// `example-review` was retired from the production manifest in issue #383
// (complaints is the only live Case Type), so the store now seeds itself with
// complaints alone. The bank-editor component tests, however, were written
// against example-review's richer catalogue (five questions, a showWhen rule,
// multiple Outcome options) and remain the canonical exercise of the editor.
// Rather than migrate every assertion to complaints, these tests reset the
// store and overlay the example-review fixture through this seam — the tests
// no longer depend on which Case Types happen to be live in production.

import { loadBank } from '../case-types/load-bank.js';
import {
  questionBanks,
  normaliseQuestionBank,
} from '../src/question-bank/question-bank-source.js';
import {
  cases,
  baseline,
  activeSlug,
  _resetStore,
} from '../src/question-bank/question-bank-store.js';

const exampleReviewBank = normaliseQuestionBank(
  await loadBank(
    new URL('../dev/fixtures/example-review-bank.txt', import.meta.url)
  )
);

/**
 * Reset the bank-editor store to a clean state seeded with the `example-review`
 * fixture bank as the active Case Type.
 *
 * The tricky part is that reactive components left subscribed by an earlier
 * test re-render on every `.set()`, and throw if `currentBank` (i.e.
 * `cases[activeSlug]`) is ever transiently undefined. So the sequence keeps the
 * active slug present in `cases` at all times: first it points `activeSlug` at
 * a manifest bank that `_resetStore()` is guaranteed to keep, then it overlays
 * the example-review fixture and switches to it last.
 */
export function resetStoreWithExampleReview() {
  const manifestSlug = Object.keys(questionBanks)[0];
  cases.set({ ...structuredClone(questionBanks), ...cases.get() });
  activeSlug.set(manifestSlug);

  _resetStore();

  cases.set({
    ...cases.get(),
    'example-review': structuredClone(exampleReviewBank),
  });
  baseline.set({
    ...baseline.get(),
    'example-review': structuredClone(exampleReviewBank),
  });
  activeSlug.set('example-review');
}
