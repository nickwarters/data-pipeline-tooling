// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../case-types/product-sale-review.js';
import { detectCycles } from '../src/evaluators/applicability-evaluator.js';

/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

/**
 * @param {string} value
 * @returns {Answer}
 */
function ans(value) {
  return { value };
}

// --- catalogue shape ---

test('product-sale-review: catalogue has at least 8 questions', () => {
  assert.ok(
    config.questions.length >= 8,
    `got ${config.questions.length} questions`
  );
});

test('product-sale-review: attributes failures to a person', () => {
  assert.equal(config.attributeFailures, true);
});

test('product-sale-review: catalogue spans at least 2 distinct sections (category)', () => {
  const cats = new Set(config.questions.map((q) => q.category).filter(Boolean));
  assert.ok(cats.size >= 2, `got categories: ${[...cats].join(', ')}`);
});

test('product-sale-review: every choice question has a non-empty options[]', () => {
  for (const q of config.questions) {
    if (
      q.responseType === 'single-choice' ||
      q.responseType === 'multi-choice'
    ) {
      assert.ok(
        Array.isArray(q.options) && q.options.length > 0,
        `${q.id} (${q.responseType}) should have options[]`
      );
    }
  }
});

test('product-sale-review: at least one question has a showWhen rule', () => {
  const withShowWhen = config.questions.filter((q) => q.showWhen != null);
  assert.ok(withShowWhen.length >= 1, 'expected at least one showWhen');
});

test('product-sale-review: showWhen references a question in the catalogue', () => {
  const ids = new Set(config.questions.map((q) => q.id));
  for (const q of config.questions.filter((q) => q.showWhen != null)) {
    for (const refId of Object.keys(
      /** @type {Record<string,unknown>} */ (q.showWhen)
    )) {
      assert.ok(
        ids.has(refId),
        `${q.id}.showWhen references ${refId} which is not in the catalogue`
      );
    }
  }
});

test('product-sale-review: at least one question has failureCriteria and remediationActions', () => {
  const withBoth = config.questions.filter(
    (q) =>
      q.failureCriteria != null &&
      q.remediationActions &&
      q.remediationActions.length > 0
  );
  assert.ok(withBoth.length >= 1);
});

test('product-sale-review: no cycles in showWhen graph', () => {
  assert.strictEqual(detectCycles(config.questions), false);
});

// --- computeOutcome ---

test('product-sale-review computeOutcome: empty answers → pass', () => {
  assert.deepStrictEqual(config.computeOutcome({}), { outcome: 'pass' });
});

test('product-sale-review computeOutcome: no failures → pass', () => {
  const answers = Object.fromEntries(
    config.questions.map((q) => [q.id, ans('Yes')])
  );
  assert.deepStrictEqual(config.computeOutcome(answers), { outcome: 'pass' });
});

test('product-sale-review computeOutcome: two or more failures → fail', () => {
  const failing = config.questions.filter((q) => q.failureCriteria != null);
  assert.ok(
    failing.length >= 2,
    'expected at least two questions with failureCriteria'
  );
  const answers = Object.fromEntries(
    failing
      .slice(0, 2)
      .map((q) => [q.id, ans(/** @type {string} */ (q.failureCriteria))])
  );
  assert.deepStrictEqual(config.computeOutcome(answers), { outcome: 'fail' });
});

test('product-sale-review computeOutcome: exactly one failure → refer', () => {
  const q = config.questions.find((q) => q.failureCriteria != null);
  assert.ok(q, 'expected at least one question with failureCriteria');
  assert.deepStrictEqual(
    config.computeOutcome({
      [q.id]: ans(/** @type {string} */ (q.failureCriteria)),
    }),
    { outcome: 'refer' }
  );
});

test('product-sale-review computeOutcome: informational General question without failureCriteria does not refer or fail', () => {
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition} */
  const infoQuestion = {
    id: 'q-general-info',
    text: 'Was the case context reviewed?',
    category: 'General',
    responseType: 'yes-no-na',
    deprecated: false,
  };
  config.questions.push(infoQuestion);
  try {
    assert.deepStrictEqual(
      config.computeOutcome({
        [infoQuestion.id]: ans('No'),
      }),
      { outcome: 'pass' }
    );
  } finally {
    config.questions.pop();
  }
});
