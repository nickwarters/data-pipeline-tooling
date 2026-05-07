// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../case-types/hello-review.js';
import { detectCycles } from '../src/applicability-evaluator.js';

/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

/**
 * @param {string} value
 * @returns {Answer}
 */
function ans(value) {
  return { value };
}

// --- catalogue shape ---

test('hello-review: catalogue has exactly 5 questions', () => {
  assert.strictEqual(config.questions.length, 5);
});

test('hello-review: catalogue covers all three response types', () => {
  const types = new Set(config.questions.map(q => q.responseType));
  assert.ok(types.has('yes-no-na'));
  assert.ok(types.has('single-choice'));
  assert.ok(types.has('multi-choice'));
});

test('hello-review: every choice question carries a non-empty options[]', () => {
  for (const q of config.questions) {
    if (q.responseType === 'single-choice' || q.responseType === 'multi-choice') {
      assert.ok(Array.isArray(q.options) && q.options.length > 0,
        `${q.id} (${q.responseType}) should have options[]`);
    }
  }
});

test('hello-review: exactly one question has a showWhen rule', () => {
  const withShowWhen = config.questions.filter(q => q.showWhen != null);
  assert.strictEqual(withShowWhen.length, 1);
});

test('hello-review: showWhen references another question in the catalogue', () => {
  const ids = new Set(config.questions.map(q => q.id));
  const conditional = config.questions.find(q => q.showWhen != null);
  assert.ok(conditional, 'expected a question with showWhen');
  const refId = Object.keys(/** @type {Record<string,unknown>} */ (conditional.showWhen))[0];
  assert.ok(ids.has(refId), `showWhen references ${refId} which is not in the catalogue`);
});

test('hello-review: at least one question has a non-empty remediationActions array', () => {
  const withRemediation = config.questions.filter(q => q.remediationActions && q.remediationActions.length > 0);
  assert.ok(withRemediation.length >= 1);
});

test('hello-review: no cycles in showWhen graph', () => {
  assert.strictEqual(detectCycles(config.questions), false);
});

// --- computeOutcome ---

test('computeOutcome: all Yes → pass', () => {
  const answers = Object.fromEntries(config.questions.map(q => [q.id, ans('Yes')]));
  assert.deepStrictEqual(config.computeOutcome(answers), { verdict: 'pass' });
});

test('computeOutcome: any No → fail', () => {
  const answers = Object.fromEntries(config.questions.map(q => [q.id, ans('Yes')]));
  const [first] = config.questions;
  answers[first.id] = ans('No');
  assert.deepStrictEqual(config.computeOutcome(answers), { verdict: 'fail' });
});

test('computeOutcome: all N/A → pass', () => {
  const answers = Object.fromEntries(config.questions.map(q => [q.id, ans('N/A')]));
  assert.deepStrictEqual(config.computeOutcome(answers), { verdict: 'pass' });
});

test('computeOutcome: mix of Yes and N/A → pass', () => {
  const [q1, q2, q3] = config.questions;
  const answers = { [q1.id]: ans('Yes'), [q2.id]: ans('N/A'), [q3.id]: ans('Yes') };
  assert.deepStrictEqual(config.computeOutcome(answers), { verdict: 'pass' });
});

test('computeOutcome: No among Yes and N/A → fail', () => {
  const [q1, q2, q3] = config.questions;
  const answers = { [q1.id]: ans('Yes'), [q2.id]: ans('No'), [q3.id]: ans('N/A') };
  assert.deepStrictEqual(config.computeOutcome(answers), { verdict: 'fail' });
});

test('computeOutcome: empty answers → pass (no No)', () => {
  assert.deepStrictEqual(config.computeOutcome({}), { verdict: 'pass' });
});
