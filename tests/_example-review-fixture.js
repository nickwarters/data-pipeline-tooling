// @ts-check
// Store-free `example-review` fixture bank for component tests.
//
// The store-inversion work (issue #382) requires component tests to mount
// `cora-*` editors with plain props and an `onCommit` spy instead of the
// bank-editor store singleton. This helper hands each test its own deep clone
// of the example-review bank so tests can mutate freely without cross-test
// bleed and without importing `question-bank-store.js`.

import { loadBank } from '../case-types/load-bank.js';
import { normaliseQuestionBank } from '../src/question-bank/question-bank-source.js';

const exampleReviewBank = normaliseQuestionBank(
  await loadBank(new URL('./_example-review-bank.txt', import.meta.url))
);

/**
 * A fresh deep clone of the normalised example-review bank.
 *
 * @returns {import('../src/question-bank/question-bank-source.js').QuestionBank}
 */
export function freshExampleReviewBank() {
  return structuredClone(exampleReviewBank);
}

/**
 * An `onCommit` spy: applies each mutation (like the real store `commit()`)
 * and counts invocations so tests can assert mutations flow through the
 * callback rather than a module-scope store import.
 *
 * @returns {{ (fn: (types?: any) => void): void, calls: number }}
 */
export function commitSpy() {
  const spy = /** @type {any} */ (
    (/** @type {(types?: any) => void} */ fn) => {
      spy.calls += 1;
      fn();
    }
  );
  spy.calls = 0;
  return spy;
}
