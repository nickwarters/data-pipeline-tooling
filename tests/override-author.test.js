// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTransition, validateOverride, buildOverride } from '../src/evaluators/override-author.js';

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

/** @returns {QuestionDefinition} */
function makeQuestion(overrides = {}) {
  return {
    id: 'q1',
    text: 'Was the call recorded?',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    remediationActions: ['Re-record the call'],
    deprecated: false,
    ...overrides,
  };
}

test('validateOverride: empty reasoning is rejected', () => {
  const errors = validateOverride(
    { answerKey: 'q1', value: 'Yes', reasoning: '   ' },
    { question: makeQuestion(), originalAnswer: { value: 'Yes' } }
  );
  assert.ok(errors.includes('Reasoning is required.'));
});

test('validateOverride: a non-empty reasoning with no failure-status change is valid', () => {
  const errors = validateOverride(
    { answerKey: 'q1', value: 'N/A', reasoning: 'Question was not applicable.' },
    { question: makeQuestion(), originalAnswer: { value: 'Yes' } }
  );
  assert.deepEqual(errors, []);
});

test('classifyTransition: pass→fail when the value newly meets the failure criteria', () => {
  assert.equal(classifyTransition(makeQuestion(), { value: 'Yes' }, 'No'), 'pass→fail');
});

test('classifyTransition: fail→pass when the value stops meeting the failure criteria', () => {
  assert.equal(classifyTransition(makeQuestion(), { value: 'No' }, 'Yes'), 'fail→pass');
});

test('classifyTransition: fail→fail when still failing (multi-choice swap)', () => {
  const q = makeQuestion({ responseType: 'multi-choice', failureCriteria: 'Late' });
  assert.equal(classifyTransition(q, { value: ['Late'] }, ['Late', 'Other']), 'fail→fail');
});

test('classifyTransition: pass→pass when neither value fails', () => {
  assert.equal(classifyTransition(makeQuestion(), { value: 'Yes' }, 'N/A'), 'pass→pass');
});

test('validateOverride: pass→fail with no required details and no attribution is valid', () => {
  // Case Type with neither required details nor attributeFailures: the gate is empty.
  const errors = validateOverride(
    { answerKey: 'q1', value: 'No', reasoning: 'Reviewer missed it.' },
    { question: makeQuestion(), originalAnswer: { value: 'Yes' } }
  );
  assert.deepEqual(errors, []);
});

test('validateOverride: pass→fail missing a required Remediation Detail is rejected', () => {
  const errors = validateOverride(
    { answerKey: 'q1', value: 'No', reasoning: 'Reviewer missed it.' },
    {
      question: makeQuestion(),
      originalAnswer: { value: 'Yes' },
      remediationFields: [{ key: 'rootCause', label: 'Root cause', type: 'text', required: true }],
    }
  );
  assert.ok(errors.some((e) => e.includes('Root cause')));
});

test('validateOverride: pass→fail with the required detail supplied is valid', () => {
  const errors = validateOverride(
    {
      answerKey: 'q1',
      value: 'No',
      reasoning: 'Reviewer missed it.',
      remediationDetails: { rootCause: 'Training gap' },
    },
    {
      question: makeQuestion(),
      originalAnswer: { value: 'Yes' },
      remediationFields: [{ key: 'rootCause', label: 'Root cause', type: 'text', required: true }],
    }
  );
  assert.deepEqual(errors, []);
});

test('validateOverride: pass→fail without an Attributed Party is rejected when attributeFailures', () => {
  const errors = validateOverride(
    { answerKey: 'q1', value: 'No', reasoning: 'Reviewer missed it.' },
    { question: makeQuestion(), originalAnswer: { value: 'Yes' }, attributeFailures: true }
  );
  assert.ok(errors.some((e) => e.includes('Attributed Party')));
});

test('validateOverride: pass→fail with an Attributed Party is valid when attributeFailures', () => {
  const errors = validateOverride(
    {
      answerKey: 'q1',
      value: 'No',
      reasoning: 'Reviewer missed it.',
      attributedParty: { loginName: 'jdoe', displayName: 'J Doe' },
    },
    { question: makeQuestion(), originalAnswer: { value: 'Yes' }, attributeFailures: true }
  );
  assert.deepEqual(errors, []);
});

test('validateOverride: a fail→pass Override is not gated even when attributeFailures is set', () => {
  const errors = validateOverride(
    { answerKey: 'q1', value: 'Yes', reasoning: 'Originally answered wrong.' },
    {
      question: makeQuestion(),
      originalAnswer: { value: 'No' },
      attributeFailures: true,
      remediationFields: [{ key: 'rootCause', label: 'Root cause', type: 'text', required: true }],
    }
  );
  assert.deepEqual(errors, []);
});

test('validateOverride: a non-required Remediation Detail left blank on pass→fail is allowed', () => {
  const errors = validateOverride(
    {
      answerKey: 'q1',
      value: 'No',
      reasoning: 'Reviewer missed it.',
      attributedParty: { loginName: 'jdoe', displayName: 'J Doe' },
    },
    {
      question: makeQuestion(),
      originalAnswer: { value: 'Yes' },
      attributeFailures: true,
      remediationFields: [{ key: 'notes', label: 'Notes', type: 'text' }],
    }
  );
  assert.deepEqual(errors, []);
});

test('buildOverride: throws when the draft fails validation', () => {
  assert.throws(
    () =>
      buildOverride(
        { answerKey: 'q1', value: 'No', reasoning: '' },
        { question: makeQuestion(), originalAnswer: { value: 'Yes' }, author: 'qa1', at: '2026-06-11T00:00:00Z' }
      ),
    /Reasoning is required/
  );
});

test('buildOverride: stamps source qa, author, at and carries the replacement set', () => {
  const override = buildOverride(
    {
      answerKey: 'q1',
      value: 'No',
      reasoning: 'Reviewer missed it.',
      attributedParty: { loginName: 'jdoe', displayName: 'J Doe' },
      remediationActions: [{ id: 'q1-ra-0', text: 'Re-record', completed: false }],
      remediationDetails: { rootCause: 'Training gap' },
    },
    {
      question: makeQuestion(),
      originalAnswer: { value: 'Yes' },
      attributeFailures: true,
      author: 'qa1',
      at: '2026-06-11T00:00:00Z',
    }
  );
  assert.equal(override.source, 'qa');
  assert.equal(override.author, 'qa1');
  assert.equal(override.at, '2026-06-11T00:00:00Z');
  assert.equal(override.answerKey, 'q1');
  assert.equal(override.value, 'No');
  assert.equal(override.reasoning, 'Reviewer missed it.');
  assert.deepEqual(override.attributedParty, { loginName: 'jdoe', displayName: 'J Doe' });
  assert.equal(override.remediationDetails?.rootCause, 'Training gap');
  // An ad-hoc QA correction carries no sourceCaseId.
  assert.equal(override.sourceCaseId, undefined);
});

test('buildOverride: an Appeal-sourced Override stamps source appeal and the sourceAppealId', () => {
  const override = buildOverride(
    { answerKey: 'q1', value: 'Yes', reasoning: 'Appeal upheld.' },
    {
      question: makeQuestion(),
      originalAnswer: { value: 'No' },
      author: 'qa1',
      at: '2026-06-11T00:00:00Z',
      source: 'appeal',
      sourceAppealId: 'appeal-1',
    }
  );
  assert.equal(override.source, 'appeal');
  assert.equal(override.sourceAppealId, 'appeal-1');
});
