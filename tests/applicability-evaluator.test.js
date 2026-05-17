// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, allApplicableAnswered, detectCycles } from '../src/evaluators/applicability-evaluator.js';

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

test('evaluate: showWhen with unknown operator evaluates to false (question not applicable)', () => {
  const catalogue = [
    q('q1'),
    q('q2', { q1: { unsupportedOp: 'Yes' } }),
  ];
  const answers = { q1: ans('Yes') };
  const result = evaluate(catalogue, answers);
  assert.ok(result.has('q1'));
  assert.ok(!result.has('q2'), 'unknown operator should make the condition evaluate to false');
});

// --- allApplicableAnswered ---

test('allApplicableAnswered: returns true for empty catalogue', () => {
  assert.strictEqual(allApplicableAnswered([], {}), true);
});

test('allApplicableAnswered: returns true when all applicable questions have values', () => {
  const catalogue = [q('q1'), q('q2')];
  const answers = { q1: ans('Yes'), q2: ans('No') };
  assert.strictEqual(allApplicableAnswered(catalogue, answers), true);
});

test('allApplicableAnswered: returns false when an applicable question is missing from answers', () => {
  const catalogue = [q('q1'), q('q2')];
  const answers = { q1: ans('Yes') };
  assert.strictEqual(allApplicableAnswered(catalogue, answers), false);
});

test('allApplicableAnswered: returns false when an applicable question has empty string value', () => {
  const catalogue = [q('q1')];
  const answers = { q1: ans('') };
  assert.strictEqual(allApplicableAnswered(catalogue, answers), false);
});

test('allApplicableAnswered: returns false when an applicable question has empty array value', () => {
  const catalogue = [q('q1')];
  const answers = { q1: ans([]) };
  assert.strictEqual(allApplicableAnswered(catalogue, answers), false);
});

test('allApplicableAnswered: returns false when an applicable question has null value', () => {
  const catalogue = [q('q1')];
  // @ts-ignore
  const answers = { q1: { value: null } };
  assert.strictEqual(allApplicableAnswered(catalogue, answers), false);
});


test('allApplicableAnswered: returns true when only non-applicable questions are missing', () => {
  const catalogue = [q('q1'), q('q2', { q1: { equals: 'Yes' } })];
  const answers = { q1: ans('No') };
  assert.strictEqual(allApplicableAnswered(catalogue, answers), true);
});

// --- evalCondition / evalOp edge cases ---

test('evaluate: showWhen with mixed $and and direct keys', () => {
  // evalCondition iterates Object.entries(cond)
  const catalogue = [
    q('q1'), q('q2'),
    q('q3', { q1: { equals: 'Yes' }, $and: [{ q2: { equals: 'Yes' } }] })
  ];
  assert.ok(evaluate(catalogue, { q1: ans('Yes'), q2: ans('Yes') }).has('q3'));
  assert.ok(!evaluate(catalogue, { q1: ans('Yes'), q2: ans('No') }).has('q3'));
});

// --- detectCycles / extractRefs edge cases ---

test('detectCycles: empty $and or $or branches', () => {
  const catalogue = [
    q('q1', { $and: [] }),
    q('q2', { $or: [] })
  ];
  assert.strictEqual(detectCycles(catalogue), false);
  const result = evaluate(catalogue, {});
  assert.ok(result.has('q1')); // every([]) is true
  assert.ok(!result.has('q2')); // some([]) is false
});

test('detectCycles: $or composition branch coverage', () => {
  const catalogue = [
    q('q1', { $or: [{ q2: { equals: 'Yes' } }] }),
    q('q2')
  ];
  assert.strictEqual(detectCycles(catalogue), false);
});

test('evaluate: showWhen answered:false (unsupported but covers branch)', () => {
  const catalogue = [q('q1', { q2: { answered: false } }), q('q2')];
  // evalOp returns false for anything other than answered:true
  assert.ok(!evaluate(catalogue, { q2: ans('Yes') }).has('q1'));
});

test('evaluate: empty object showWhen', () => {
  const catalogue = [q('q1', {})];
  assert.ok(evaluate(catalogue, {}).has('q1'));
});

test('evaluate: showWhen with $and true but another key false', () => {
  const catalogue = [
    q('q1'), q('q2'),
    q('q3', { $and: [{ q1: { equals: 'Yes' } }], q2: { equals: 'Yes' } })
  ];
  // If $and is present, the code returns its result IMMEDIATELY.
  // This means q2: { equals: 'Yes' } is IGNORED if $and is present.
  // This is a bug or intended behavior? 
  // Line 83: if ('$and' in cond) return ...
  assert.ok(evaluate(catalogue, { q1: ans('Yes'), q2: ans('No') }).has('q3'));
});

test('evaluate: showWhen with $or false but another key true', () => {
  const catalogue = [
    q('q1'), q('q2'),
    q('q3', { $or: [{ q1: { equals: 'Yes' } }], q2: { equals: 'Yes' } })
  ];
  // Line 86: if ('$or' in cond) return ...
  // Since $or is true, it returns true and ignores q2.
  assert.ok(evaluate(catalogue, { q1: ans('Yes'), q2: ans('No') }).has('q3'));
});

test('detectCycles: extractRefs with undefined', () => {
  // @ts-ignore
  const catalogue = [{ id: 'q1', showWhen: undefined }];
  assert.strictEqual(detectCycles(catalogue), false);
});

test('detectCycles: external reference branch', () => {
  const catalogue = [
    q('q1', { external: { equals: 'Yes' } })
  ];
  // Line 65: if (!ids.has(dep)) continue;
  assert.strictEqual(detectCycles(catalogue), false);
});

test('detectCycles: node already BLACK branch', () => {
  const catalogue = [
    q('q1', { q2: { equals: 'Yes' } }),
    q('q2', { q3: { equals: 'Yes' } }),
    q('q3')
  ];
  // This will visit q3, mark it BLACK, then q2 visits q3 again.
  assert.strictEqual(detectCycles(catalogue), false);
});

test('evaluate: showWhen in with string answer', () => {
  const catalogue = [q('q1', { q2: { in: ['Yes', 'Maybe'] } }), q('q2')];
  assert.ok(evaluate(catalogue, { q2: ans('Yes') }).has('q1'));
  assert.ok(!evaluate(catalogue, { q2: ans('No') }).has('q1'));
});

test('detectCycles: extractRefs with empty object', () => {
  const catalogue = [
    q('q1', {})
  ];
  assert.strictEqual(detectCycles(catalogue), false);
});

test('allApplicableAnswered: returns true when applicable multi-choice question has non-empty array value', () => {
  const catalogue = [q('q1')];
  const answers = { q1: { value: ['Option A', 'Option B'] } };
  assert.strictEqual(allApplicableAnswered(catalogue, answers), true);
});









