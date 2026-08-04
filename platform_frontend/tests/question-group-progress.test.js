// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuestionGroupProgress } from '../src/evaluators/question-group-progress.js';

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

/** @param {string} id @param {string} [questionGroup] @param {Record<string, unknown>} [showWhen] @returns {QuestionDefinition} */
function q(id, questionGroup, showWhen) {
  return {
    id,
    text: id,
    responseType: 'yes-no-na',
    deprecated: false,
    questionGroup,
    ...(showWhen ? { showWhen } : {}),
  };
}

/** @param {string | string[]} value @returns {Answer} */
function ans(value) {
  return { value };
}

// --- Question Group grouping ---

test('computeQuestionGroupProgress: returns one entry per distinct Question Group', () => {
  const catalogue = [q('q1', 'Opening'), q('q2', 'Discovery')];
  const result = computeQuestionGroupProgress(catalogue, {});
  assert.equal(result.length, 2);
  assert.equal(result[0].group, 'Opening');
  assert.equal(result[1].group, 'Discovery');
});

test('computeQuestionGroupProgress: questions without a Question Group are grouped as General', () => {
  const catalogue = [q('q1', undefined), q('q2', 'Opening')];
  const result = computeQuestionGroupProgress(catalogue, {});
  const sections = result.map((r) => r.group);
  assert.ok(sections.includes('General'));
  assert.ok(sections.includes('Opening'));
});

test('computeQuestionGroupProgress: preserves group order (first-seen)', () => {
  const catalogue = [q('q1', 'C'), q('q2', 'A'), q('q3', 'B')];
  const result = computeQuestionGroupProgress(catalogue, {});
  assert.deepEqual(
    result.map((r) => r.group),
    ['C', 'A', 'B']
  );
});

// --- total counts (applicable questions only) ---

test('computeQuestionGroupProgress: total counts only applicable questions', () => {
  const catalogue = [
    q('q1', 'Opening'),
    q('q2', 'Opening', { q1: { equals: 'Yes' } }),
  ];
  // q2 not applicable (q1 unanswered)
  const result = computeQuestionGroupProgress(catalogue, {});
  assert.equal(result[0].total, 1);
});

test('computeQuestionGroupProgress: total updates when conditional becomes applicable', () => {
  const catalogue = [
    q('q1', 'Opening'),
    q('q2', 'Opening', { q1: { equals: 'Yes' } }),
  ];
  const result = computeQuestionGroupProgress(catalogue, { q1: ans('Yes') });
  assert.equal(result[0].total, 2);
});

// --- answered counts ---

test('computeQuestionGroupProgress: answered is 0 when no answers given', () => {
  const catalogue = [q('q1', 'Opening'), q('q2', 'Opening')];
  const result = computeQuestionGroupProgress(catalogue, {});
  assert.equal(result[0].answered, 0);
});

test('computeQuestionGroupProgress: answered counts questions with non-empty string value', () => {
  const catalogue = [q('q1', 'Opening'), q('q2', 'Opening')];
  const result = computeQuestionGroupProgress(catalogue, { q1: ans('Yes') });
  assert.equal(result[0].answered, 1);
});

test('computeQuestionGroupProgress: answered counts questions with non-empty array value', () => {
  const catalogue = [q('q1', 'Opening')];
  const result = computeQuestionGroupProgress(catalogue, {
    q1: ans(['A', 'B']),
  });
  assert.equal(result[0].answered, 1);
});

test('computeQuestionGroupProgress: empty array value is not answered', () => {
  const catalogue = [q('q1', 'Opening')];
  const result = computeQuestionGroupProgress(catalogue, { q1: ans([]) });
  assert.equal(result[0].answered, 0);
});

test('computeQuestionGroupProgress: empty string value is not answered', () => {
  const catalogue = [q('q1', 'Opening')];
  const result = computeQuestionGroupProgress(catalogue, { q1: ans('') });
  assert.equal(result[0].answered, 0);
});

test('computeQuestionGroupProgress: only applicable answered questions count', () => {
  const catalogue = [
    q('q1', 'Opening'),
    q('q2', 'Opening', { q1: { equals: 'Yes' } }),
  ];
  // q2 not applicable even though it has an answer
  const result = computeQuestionGroupProgress(catalogue, { q2: ans('Yes') });
  assert.equal(result[0].answered, 0);
  assert.equal(result[0].total, 1);
});

// --- completed section ---

test('computeQuestionGroupProgress: group is complete when answered === total', () => {
  const catalogue = [q('q1', 'Opening')];
  const result = computeQuestionGroupProgress(catalogue, { q1: ans('Yes') });
  assert.equal(result[0].answered, 1);
  assert.equal(result[0].total, 1);
});

test('computeQuestionGroupProgress: empty catalogue returns empty array', () => {
  const result = computeQuestionGroupProgress([], {});
  assert.deepEqual(result, []);
});

// --- findNextUnanswered ---

test('computeQuestionGroupProgress: deprecated questions are excluded', () => {
  const catalogue = [
    {
      id: 'q1',
      text: 'q1',
      responseType: /** @type {'yes-no-na'} */ ('yes-no-na'),
      deprecated: true,
      questionGroup: 'Opening',
    },
    q('q2', 'Opening'),
  ];
  const result = computeQuestionGroupProgress(catalogue, {});
  assert.equal(result[0].total, 1);
});

test('computeQuestionGroupProgress: an N/A Answer counts as answered', () => {
  const catalogue = [q('q1', 'Opening'), q('q2', 'Opening')];
  const result = computeQuestionGroupProgress(catalogue, {
    q1: ans('NA'),
    q2: ans(['NA']),
  });
  assert.equal(result[0].answered, 2);
});
