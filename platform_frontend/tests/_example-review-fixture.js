// @ts-check
// Store-free `example-review` fixture bank for pure Question Bank view tests.

import { loadBank } from '../case-types/load-bank.js';
import { normaliseQuestionBank } from '../src/pages/question-bank/question-bank-source.js';

const exampleReviewBank = normaliseQuestionBank(
  await loadBank(new URL('./_example-review-bank.txt', import.meta.url))
);

/**
 * A fresh deep clone of the normalised example-review bank.
 *
 * @returns {import('../src/pages/question-bank/question-bank-source.js').QuestionBank}
 */
export function freshExampleReviewBank() {
  return structuredClone(exampleReviewBank);
}
