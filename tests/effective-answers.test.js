// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveAnswers,
  currentOutcome,
  buildOverrideRows,
} from '../src/evaluators/effective-answers.js';

/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */
/** @typedef {import('../src/sharepoint-client.js').Override} Override */

test('effectiveAnswers: no overrides yields the frozen Answers unchanged', () => {
  /** @type {Record<string, Answer>} */
  const answers = { 'q-welcome': { value: 'Yes' } };
  assert.deepEqual(effectiveAnswers(answers, []), answers);
  assert.deepEqual(effectiveAnswers(answers, undefined), answers);
});

test('effectiveAnswers: fail→pass Override drops the original failure metadata', () => {
  /** @type {Record<string, Answer>} */
  const answers = {
    'q-welcome': {
      value: 'No',
      remediationActions: [{ id: 'ra-1', text: 'Retrain.', completed: false }],
      attributedParty: { loginName: 'agent', displayName: 'Agent A' },
      remediationDetails: { rootCause: 'Missed greeting' },
    },
  };
  /** @type {Override[]} */
  const overrides = [
    {
      source: 'qa',
      author: 'qa-1',
      at: '2026-06-11T00:00:00Z',
      answerKey: 'q-welcome',
      value: 'Yes',
      reasoning: 'Greeting was present on the recording.',
    },
  ];
  assert.deepEqual(effectiveAnswers(answers, overrides), {
    'q-welcome': { value: 'Yes' },
  });
});

test('effectiveAnswers: fail→still-fail Override swaps the action set wholesale (replace, not merge)', () => {
  /** @type {Record<string, Answer>} */
  const answers = {
    'q-needs': {
      value: 'No',
      remediationActions: [
        { id: 'ra-old', text: 'Old action.', completed: true },
      ],
      attributedParty: { loginName: 'agent', displayName: 'Agent A' },
    },
  };
  /** @type {Override[]} */
  const overrides = [
    {
      source: 'appeal',
      sourceAppealId: 'ap-1',
      author: 'qa-1',
      at: '2026-06-11T00:00:00Z',
      answerKey: 'q-needs',
      value: 'No',
      remediationActions: [
        { id: 'ra-new', text: 'New action.', completed: false },
      ],
      attributedParty: { loginName: 'mgr', displayName: 'Manager M' },
      reasoning: 'Wrong party originally attributed.',
    },
  ];
  assert.deepEqual(effectiveAnswers(answers, overrides), {
    'q-needs': {
      value: 'No',
      remediationActions: [
        { id: 'ra-new', text: 'New action.', completed: false },
      ],
      attributedParty: { loginName: 'mgr', displayName: 'Manager M' },
    },
  });
});

test('effectiveAnswers: pass→fail Override adds a complete new failure set', () => {
  /** @type {Record<string, Answer>} */
  const answers = { 'q-needs': { value: 'Yes' } };
  /** @type {Override[]} */
  const overrides = [
    {
      source: 'qa',
      author: 'qa-1',
      at: '2026-06-11T00:00:00Z',
      answerKey: 'q-needs',
      value: 'No',
      remediationActions: [
        { id: 'ra-1', text: 'Retrain agent.', completed: false },
      ],
      attributedParty: { loginName: 'agent', displayName: 'Agent A' },
      remediationDetails: { rootCause: 'Skipped discovery' },
      reasoning: 'Needs were never identified.',
    },
  ];
  assert.deepEqual(effectiveAnswers(answers, overrides), {
    'q-needs': {
      value: 'No',
      remediationActions: [
        { id: 'ra-1', text: 'Retrain agent.', completed: false },
      ],
      attributedParty: { loginName: 'agent', displayName: 'Agent A' },
      remediationDetails: { rootCause: 'Skipped discovery' },
    },
  });
});

test('effectiveAnswers: leaves the frozen Answers and untouched keys intact', () => {
  /** @type {Record<string, Answer>} */
  const answers = {
    'q-welcome': {
      value: 'No',
      remediationActions: [{ id: 'ra-1', text: 'Retrain.', completed: false }],
    },
    'q-needs': { value: 'Yes' },
  };
  const snapshot = structuredClone(answers);
  /** @type {Override[]} */
  const overrides = [
    {
      source: 'qa',
      author: 'qa-1',
      at: '2026-06-11T00:00:00Z',
      answerKey: 'q-welcome',
      value: 'Yes',
      reasoning: 'Greeting present.',
    },
  ];
  const effective = effectiveAnswers(answers, overrides);
  // The frozen original is never mutated.
  assert.deepEqual(answers, snapshot);
  // Keys without an Override pass through unchanged.
  assert.deepEqual(effective['q-needs'], { value: 'Yes' });
});

// computeOutcome stand-in mirroring hello-review: any 'No' Answer fails.
/**
 * @param {Record<string, Answer>} answers
 * @returns {import('../src/sharepoint-client.js').OutcomeResult}
 */
const computeOutcome = (answers) => ({
  verdict: Object.values(answers).some((a) => a.value === 'No')
    ? 'fail'
    : 'pass',
});

test('currentOutcome: with no Override equals the original derivation (== outcomeAtCompletion)', () => {
  /** @type {Record<string, Answer>} */
  const answers = {
    'q-welcome': { value: 'Yes' },
    'q-needs': { value: 'Yes' },
  };
  assert.deepEqual(currentOutcome(computeOutcome, answers, []), {
    verdict: 'pass',
  });
});

test('currentOutcome: a pass→fail Override flips the derived verdict to fail', () => {
  /** @type {Record<string, Answer>} */
  const answers = {
    'q-welcome': { value: 'Yes' },
    'q-needs': { value: 'Yes' },
  };
  /** @type {Override[]} */
  const overrides = [
    {
      source: 'qa',
      author: 'qa-1',
      at: '2026-06-11T00:00:00Z',
      answerKey: 'q-needs',
      value: 'No',
      reasoning: 'Needs not identified.',
    },
  ];
  assert.deepEqual(currentOutcome(computeOutcome, answers, overrides), {
    verdict: 'fail',
  });
});

test('currentOutcome: a fail→pass Override flips the derived verdict to pass', () => {
  /** @type {Record<string, Answer>} */
  const answers = { 'q-welcome': { value: 'No' }, 'q-needs': { value: 'Yes' } };
  /** @type {Override[]} */
  const overrides = [
    {
      source: 'appeal',
      sourceAppealId: 'ap-1',
      author: 'qa-1',
      at: '2026-06-11T00:00:00Z',
      answerKey: 'q-welcome',
      value: 'Yes',
      reasoning: 'Appeal upheld.',
    },
  ];
  assert.deepEqual(currentOutcome(computeOutcome, answers, overrides), {
    verdict: 'pass',
  });
});

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

test('buildOverrideRows: one row per Override with question label, original→overridden value, source, reasoning', () => {
  /** @type {QuestionDefinition[]} */
  const catalogue = [
    {
      id: 'q-welcome',
      text: 'Was the customer greeted professionally?',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      deprecated: false,
    },
    {
      id: 'q-products',
      text: 'Which products were discussed?',
      responseType: 'multi-choice',
      options: ['Account', 'Billing'],
      deprecated: false,
    },
  ];
  /** @type {Record<string, Answer>} */
  const answers = {
    'q-welcome': { value: 'Yes' },
    'q-products': { value: ['Account'] },
  };
  /** @type {Override[]} */
  const overrides = [
    {
      source: 'qa',
      author: 'qa-1',
      at: '2026-06-11T00:00:00Z',
      answerKey: 'q-welcome',
      value: 'No',
      reasoning: 'Greeting absent.',
    },
    {
      source: 'appeal',
      sourceAppealId: 'ap-1',
      author: 'qa-1',
      at: '2026-06-11T00:00:00Z',
      answerKey: 'q-products',
      value: ['Account', 'Billing'],
      reasoning: 'Billing was covered.',
    },
  ];
  assert.deepEqual(buildOverrideRows(catalogue, answers, overrides), [
    {
      questionText: 'Was the customer greeted professionally?',
      originalValue: 'Yes',
      overriddenValue: 'No',
      source: 'qa',
      reasoning: 'Greeting absent.',
    },
    {
      questionText: 'Which products were discussed?',
      originalValue: 'Account',
      overriddenValue: 'Account, Billing',
      source: 'appeal',
      reasoning: 'Billing was covered.',
    },
  ]);
});

test('buildOverrideRows: falls back to the answerKey and an em dash when label or original Answer is missing', () => {
  /** @type {Override[]} */
  const overrides = [
    {
      source: 'qa',
      author: 'qa-1',
      at: '2026-06-11T00:00:00Z',
      answerKey: 'q-gone',
      value: 'No',
      reasoning: 'New failure.',
    },
  ];
  assert.deepEqual(buildOverrideRows([], {}, overrides), [
    {
      questionText: 'q-gone',
      originalValue: '—',
      overriddenValue: 'No',
      source: 'qa',
      reasoning: 'New failure.',
    },
  ]);
});
