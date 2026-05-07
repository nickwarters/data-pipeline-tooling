// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, detectCycles } from '../src/applicability-evaluator.js';

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

// --- helpers ---

/**
 * @param {string} id
 * @param {Record<string, unknown>} [showWhen]
 * @returns {QuestionDefinition}
 */
function q(id, showWhen) {
  return { id, text: id, responseType: 'yes-no-na', deprecated: false, ...(showWhen ? { showWhen } : {}) };
}

/**
 * @param {string | string[]} value
 * @returns {Answer}
 */
function ans(value) {
  return { value };
}

// --- evaluate: always-applicable ---

test('evaluate: question with no showWhen is always applicable', () => {
  const catalogue = [q('q1')];
  const result = evaluate(catalogue, {});
  assert.ok(result.has('q1'));
});

test('evaluate: multiple questions with no showWhen are all applicable', () => {
  const catalogue = [q('q1'), q('q2'), q('q3')];
  const result = evaluate(catalogue, {});
  assert.ok(result.has('q1'));
  assert.ok(result.has('q2'));
  assert.ok(result.has('q3'));
});

// --- evaluate: equals operator ---

test('evaluate: showWhen equals — included when answer matches', () => {
  const catalogue = [q('q1'), q('q2', { q1: { equals: 'Yes' } })];
  const result = evaluate(catalogue, { q1: ans('Yes') });
  assert.ok(result.has('q2'));
});

test('evaluate: showWhen equals — excluded when answer does not match', () => {
  const catalogue = [q('q1'), q('q2', { q1: { equals: 'Yes' } })];
  const result = evaluate(catalogue, { q1: ans('No') });
  assert.ok(!result.has('q2'));
});

test('evaluate: showWhen equals — excluded when question unanswered', () => {
  const catalogue = [q('q1'), q('q2', { q1: { equals: 'Yes' } })];
  const result = evaluate(catalogue, {});
  assert.ok(!result.has('q2'));
});

// --- evaluate: in operator ---

test('evaluate: showWhen in — included when answer is in array', () => {
  const catalogue = [q('q1'), q('q2', { q1: { in: ['Yes', 'NA'] } })];
  const result = evaluate(catalogue, { q1: ans('NA') });
  assert.ok(result.has('q2'));
});

test('evaluate: showWhen in — excluded when answer is not in array', () => {
  const catalogue = [q('q1'), q('q2', { q1: { in: ['Yes', 'NA'] } })];
  const result = evaluate(catalogue, { q1: ans('No') });
  assert.ok(!result.has('q2'));
});

// --- evaluate: in operator with multi-choice (array) answers ---

test('evaluate: showWhen in — multi-choice answer with matching element → applicable', () => {
  const catalogue = [q('q1'), q('q2', { q1: { in: ['Phone', 'Email'] } })];
  const result = evaluate(catalogue, { q1: ans(['Chat', 'Email']) });
  assert.ok(result.has('q2'));
});

test('evaluate: showWhen in — multi-choice answer with no matching element → not applicable', () => {
  const catalogue = [q('q1'), q('q2', { q1: { in: ['Phone', 'Email'] } })];
  const result = evaluate(catalogue, { q1: ans(['Chat', 'SMS']) });
  assert.ok(!result.has('q2'));
});

test('evaluate: showWhen in — empty multi-choice array → not applicable', () => {
  const catalogue = [q('q1'), q('q2', { q1: { in: ['Phone', 'Email'] } })];
  const result = evaluate(catalogue, { q1: ans([]) });
  assert.ok(!result.has('q2'));
});

// --- evaluate: answered operator ---

test('evaluate: showWhen answered:true — included when question has any non-empty answer', () => {
  const catalogue = [q('q1'), q('q2', { q1: { answered: true } })];
  const result = evaluate(catalogue, { q1: ans('No') });
  assert.ok(result.has('q2'));
});

test('evaluate: showWhen answered:true — excluded when question has no answer', () => {
  const catalogue = [q('q1'), q('q2', { q1: { answered: true } })];
  const result = evaluate(catalogue, {});
  assert.ok(!result.has('q2'));
});

test('evaluate: showWhen answered:true — excluded when answer value is empty string', () => {
  const catalogue = [q('q1'), q('q2', { q1: { answered: true } })];
  const result = evaluate(catalogue, { q1: ans('') });
  assert.ok(!result.has('q2'));
});

test('evaluate: showWhen answered:true — excluded when multi-choice value is empty array', () => {
  const catalogue = [q('q1'), q('q2', { q1: { answered: true } })];
  const result = evaluate(catalogue, { q1: ans([]) });
  assert.ok(!result.has('q2'));
});

test('evaluate: showWhen answered:true — included when multi-choice value is non-empty array', () => {
  const catalogue = [q('q1'), q('q2', { q1: { answered: true } })];
  const result = evaluate(catalogue, { q1: ans(['Phone']) });
  assert.ok(result.has('q2'));
});

// --- evaluate: $and composition ---

test('evaluate: $and — included when all conditions true', () => {
  const catalogue = [
    q('q1'), q('q2'),
    q('q3', { $and: [{ q1: { equals: 'Yes' } }, { q2: { answered: true } }] }),
  ];
  const result = evaluate(catalogue, { q1: ans('Yes'), q2: ans('No') });
  assert.ok(result.has('q3'));
});

test('evaluate: $and — excluded when any condition false', () => {
  const catalogue = [
    q('q1'), q('q2'),
    q('q3', { $and: [{ q1: { equals: 'Yes' } }, { q2: { answered: true } }] }),
  ];
  const result = evaluate(catalogue, { q1: ans('Yes') });
  assert.ok(!result.has('q3'));
});

// --- evaluate: $or composition ---

test('evaluate: $or — included when at least one condition true', () => {
  const catalogue = [
    q('q1'), q('q2'),
    q('q3', { $or: [{ q1: { equals: 'Yes' } }, { q2: { equals: 'Yes' } }] }),
  ];
  const result = evaluate(catalogue, { q1: ans('No'), q2: ans('Yes') });
  assert.ok(result.has('q3'));
});

test('evaluate: $or — excluded when all conditions false', () => {
  const catalogue = [
    q('q1'), q('q2'),
    q('q3', { $or: [{ q1: { equals: 'Yes' } }, { q2: { equals: 'Yes' } }] }),
  ];
  const result = evaluate(catalogue, { q1: ans('No'), q2: ans('No') });
  assert.ok(!result.has('q3'));
});

// --- evaluate: deep chains ---

test('evaluate: deep chain resolves correctly (q1 → q2 → q3)', () => {
  const catalogue = [
    q('q1'),
    q('q2', { q1: { equals: 'Yes' } }),
    q('q3', { q2: { answered: true } }),
  ];
  // q1=Yes → q2 applicable, q2 not answered → q3 not applicable
  const r1 = evaluate(catalogue, { q1: ans('Yes') });
  assert.ok(r1.has('q1'));
  assert.ok(r1.has('q2'));
  assert.ok(!r1.has('q3'));

  // q1=Yes, q2=No → q3 applicable (q2 is answered)
  const r2 = evaluate(catalogue, { q1: ans('Yes'), q2: ans('No') });
  assert.ok(r2.has('q3'));
});

// --- evaluate: unknown question ID ---

test('evaluate: showWhen referencing unknown question ID → not applicable (silently ignored)', () => {
  const catalogue = [q('q1', { unknown: { equals: 'Yes' } })];
  const result = evaluate(catalogue, {});
  assert.ok(!result.has('q1'));
});

// --- detectCycles ---

test('detectCycles: no showWhen at all → false', () => {
  const catalogue = [q('q1'), q('q2'), q('q3')];
  assert.equal(detectCycles(catalogue), false);
});

test('detectCycles: linear chain q1 → q2 → q3 → false', () => {
  const catalogue = [
    q('q1'),
    q('q2', { q1: { equals: 'Yes' } }),
    q('q3', { q2: { answered: true } }),
  ];
  assert.equal(detectCycles(catalogue), false);
});

test('detectCycles: direct self-reference → true', () => {
  const catalogue = [q('q1', { q1: { answered: true } })];
  assert.equal(detectCycles(catalogue), true);
});

test('detectCycles: two-node cycle (q1 → q2 → q1) → true', () => {
  const catalogue = [
    q('q1', { q2: { answered: true } }),
    q('q2', { q1: { answered: true } }),
  ];
  assert.equal(detectCycles(catalogue), true);
});

test('detectCycles: cycle buried in $and → true', () => {
  const catalogue = [
    q('q1'),
    q('q2', { q1: { equals: 'Yes' } }),
    q('q3', { $and: [{ q2: { answered: true } }, { q3: { answered: true } }] }),
  ];
  assert.equal(detectCycles(catalogue), true);
});

test('detectCycles: cycle buried in $or → true', () => {
  const catalogue = [
    q('q1'),
    q('q2', { $or: [{ q1: { answered: true } }, { q3: { answered: true } }] }),
    q('q3', { q2: { answered: true } }),
  ];
  assert.equal(detectCycles(catalogue), true);
});

test('detectCycles: $and with no cycle → false', () => {
  const catalogue = [
    q('q1'),
    q('q2'),
    q('q3', { $and: [{ q1: { answered: true } }, { q2: { answered: true } }] }),
  ];
  assert.equal(detectCycles(catalogue), false);
});

test('detectCycles: reference to unknown ID is not a cycle → false', () => {
  const catalogue = [q('q1', { unknown: { equals: 'Yes' } })];
  assert.equal(detectCycles(catalogue), false);
});
