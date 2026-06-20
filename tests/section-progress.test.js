// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSectionProgress } from '../src/evaluators/section-progress.js';

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

/** @param {string} id @param {string} [category] @param {Record<string, unknown>} [showWhen] @returns {QuestionDefinition} */
function q(id, category, showWhen) {
  return {
    id,
    text: id,
    responseType: 'yes-no-na',
    deprecated: false,
    category,
    ...(showWhen ? { showWhen } : {}),
  };
}

/** @param {string | string[]} value @returns {Answer} */
function ans(value) {
  return { value };
}

// --- section grouping ---

test('computeSectionProgress: returns one entry per distinct category', () => {
  const catalogue = [q('q1', 'Opening'), q('q2', 'Discovery')];
  const result = computeSectionProgress(catalogue, {});
  assert.equal(result.length, 2);
  assert.equal(result[0].section, 'Opening');
  assert.equal(result[1].section, 'Discovery');
});

test('computeSectionProgress: questions without category are grouped as General', () => {
  const catalogue = [q('q1', undefined), q('q2', 'Opening')];
  const result = computeSectionProgress(catalogue, {});
  const sections = result.map((r) => r.section);
  assert.ok(sections.includes('General'));
  assert.ok(sections.includes('Opening'));
});

test('computeSectionProgress: preserves category order (first-seen)', () => {
  const catalogue = [q('q1', 'C'), q('q2', 'A'), q('q3', 'B')];
  const result = computeSectionProgress(catalogue, {});
  assert.deepEqual(
    result.map((r) => r.section),
    ['C', 'A', 'B']
  );
});

// --- total counts (applicable questions only) ---

test('computeSectionProgress: total counts only applicable questions', () => {
  const catalogue = [
    q('q1', 'Opening'),
    q('q2', 'Opening', { q1: { equals: 'Yes' } }),
  ];
  // q2 not applicable (q1 unanswered)
  const result = computeSectionProgress(catalogue, {});
  assert.equal(result[0].total, 1);
});

test('computeSectionProgress: total updates when conditional becomes applicable', () => {
  const catalogue = [
    q('q1', 'Opening'),
    q('q2', 'Opening', { q1: { equals: 'Yes' } }),
  ];
  const result = computeSectionProgress(catalogue, { q1: ans('Yes') });
  assert.equal(result[0].total, 2);
});

// --- answered counts ---

test('computeSectionProgress: answered is 0 when no answers given', () => {
  const catalogue = [q('q1', 'Opening'), q('q2', 'Opening')];
  const result = computeSectionProgress(catalogue, {});
  assert.equal(result[0].answered, 0);
});

test('computeSectionProgress: answered counts questions with non-empty string value', () => {
  const catalogue = [q('q1', 'Opening'), q('q2', 'Opening')];
  const result = computeSectionProgress(catalogue, { q1: ans('Yes') });
  assert.equal(result[0].answered, 1);
});

test('computeSectionProgress: answered counts questions with non-empty array value', () => {
  const catalogue = [q('q1', 'Opening')];
  const result = computeSectionProgress(catalogue, { q1: ans(['A', 'B']) });
  assert.equal(result[0].answered, 1);
});

test('computeSectionProgress: empty array value is not answered', () => {
  const catalogue = [q('q1', 'Opening')];
  const result = computeSectionProgress(catalogue, { q1: ans([]) });
  assert.equal(result[0].answered, 0);
});

test('computeSectionProgress: empty string value is not answered', () => {
  const catalogue = [q('q1', 'Opening')];
  const result = computeSectionProgress(catalogue, { q1: ans('') });
  assert.equal(result[0].answered, 0);
});

test('computeSectionProgress: only applicable answered questions count', () => {
  const catalogue = [
    q('q1', 'Opening'),
    q('q2', 'Opening', { q1: { equals: 'Yes' } }),
  ];
  // q2 not applicable even though it has an answer
  const result = computeSectionProgress(catalogue, { q2: ans('Yes') });
  assert.equal(result[0].answered, 0);
  assert.equal(result[0].total, 1);
});

// --- completed section ---

test('computeSectionProgress: section is complete when answered === total', () => {
  const catalogue = [q('q1', 'Opening')];
  const result = computeSectionProgress(catalogue, { q1: ans('Yes') });
  assert.equal(result[0].answered, 1);
  assert.equal(result[0].total, 1);
});

test('computeSectionProgress: empty catalogue returns empty array', () => {
  const result = computeSectionProgress([], {});
  assert.deepEqual(result, []);
});

// --- findNextUnanswered ---

test('computeSectionProgress: deprecated questions are excluded', () => {
  const catalogue = [
    {
      id: 'q1',
      text: 'q1',
      responseType: /** @type {'yes-no-na'} */ ('yes-no-na'),
      deprecated: true,
      category: 'Opening',
    },
    q('q2', 'Opening'),
  ];
  const result = computeSectionProgress(catalogue, {});
  assert.equal(result[0].total, 1);
});
