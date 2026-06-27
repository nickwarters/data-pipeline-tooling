// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../case-types/qa-example-review.js';

/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

/** @param {Record<string, string>} values @returns {Record<string, Answer>} */
function answers(values) {
  /** @type {Record<string, Answer>} */
  const out = {};
  for (const [k, v] of Object.entries(values)) out[k] = { value: v };
  return out;
}

// --- catalogue shape (a tracer of the qa-{slug} extension point) ---

test('qa-example-review: catalogue has at least 2 QA-specific Question Definitions', () => {
  assert.ok(
    config.questions.length >= 2,
    `got ${config.questions.length} questions`
  );
});

test('qa-example-review: every choice question has a non-empty options[]', () => {
  for (const q of config.questions) {
    if (
      q.responseType === 'single-choice' ||
      q.responseType === 'multi-choice'
    ) {
      assert.ok(
        Array.isArray(q.options) && q.options.length > 0,
        `${q.id} needs options[]`
      );
    }
  }
});

test('qa-example-review: showWhen rules reference questions in the catalogue', () => {
  const ids = new Set(config.questions.map((q) => q.id));
  for (const q of config.questions.filter((q) => q.showWhen != null)) {
    for (const ref of Object.keys(
      /** @type {Record<string, unknown>} */ (q.showWhen)
    )) {
      assert.ok(ids.has(ref), `${q.id}.showWhen references unknown ${ref}`);
    }
  }
});

// --- outcome (QA Answers only; never the source Case's Answers) ---

test('qa-example-review: a clean QA review passes', () => {
  const result = config.computeOutcome(
    answers({
      'qa-process': 'Yes',
      'qa-evidence': 'Yes',
      'qa-outcome-correct': 'Yes',
    })
  );
  assert.equal(result.outcome, 'pass');
});

test('qa-example-review: an incorrect original Outcome fails the QA Check', () => {
  const result = config.computeOutcome(
    answers({
      'qa-process': 'Yes',
      'qa-evidence': 'Yes',
      'qa-outcome-correct': 'No',
    })
  );
  assert.equal(result.outcome, 'fail');
});

test('qa-example-review: a process/evidence lapse with a correct outcome is referred', () => {
  const result = config.computeOutcome(
    answers({
      'qa-process': 'No',
      'qa-evidence': 'Yes',
      'qa-outcome-correct': 'Yes',
    })
  );
  assert.equal(result.outcome, 'refer');

  const evidence = config.computeOutcome(
    answers({
      'qa-process': 'Yes',
      'qa-evidence': 'No',
      'qa-outcome-correct': 'Yes',
    })
  );
  assert.equal(evidence.outcome, 'refer');
});
