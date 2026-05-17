// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isFailure, materializeRemediationActions } from '../src/evaluators/failure-evaluator.js';

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/** @type {QuestionDefinition} */
const Q_FAIL_NO = {
  id: 'q-needs',
  text: 'Were the customer\'s needs identified?',
  responseType: 'yes-no-na',
  failureCriteria: 'No',
  remediationActions: ['Retrain agent.', 'Update script.'],
  deprecated: false,
};

/** @type {QuestionDefinition} */
const Q_NO_CRITERIA = {
  id: 'q-channel',
  text: 'Which channel?',
  responseType: 'single-choice',
  options: ['Phone', 'Email'],
  deprecated: false,
};

/** @type {QuestionDefinition} */
const Q_MULTI = {
  id: 'q-products',
  text: 'Which products?',
  responseType: 'multi-choice',
  options: ['Account', 'Billing', 'Support'],
  failureCriteria: 'Billing',
  remediationActions: ['Refer to billing team.'],
  deprecated: false,
};

// ===== isFailure =====

test('isFailure: returns false when question has no failureCriteria', () => {
  assert.equal(isFailure(Q_NO_CRITERIA, { value: 'Phone' }), false);
});

test('isFailure: returns false when answer is undefined', () => {
  assert.equal(isFailure(Q_FAIL_NO, undefined), false);
});

test('isFailure: returns true when string value matches failureCriteria', () => {
  assert.equal(isFailure(Q_FAIL_NO, { value: 'No' }), true);
});

test('isFailure: returns false when string value does not match', () => {
  assert.equal(isFailure(Q_FAIL_NO, { value: 'Yes' }), false);
  assert.equal(isFailure(Q_FAIL_NO, { value: 'NA' }), false);
});

test('isFailure: returns true when array value includes failureCriteria', () => {
  assert.equal(isFailure(Q_MULTI, { value: ['Account', 'Billing'] }), true);
});

test('isFailure: returns false when array value does not include failureCriteria', () => {
  assert.equal(isFailure(Q_MULTI, { value: ['Account', 'Support'] }), false);
});

test('isFailure: returns false for empty array', () => {
  assert.equal(isFailure(Q_MULTI, { value: [] }), false);
});

// ===== materializeRemediationActions =====

test('materializeRemediationActions: hydrates actions on failed answer', () => {
  const out = materializeRemediationActions(Q_FAIL_NO, { value: 'No' });
  assert.deepEqual(out.remediationActions, [
    { id: 'q-needs-ra-0', text: 'Retrain agent.', completed: false },
    { id: 'q-needs-ra-1', text: 'Update script.', completed: false },
  ]);
});

test('materializeRemediationActions: preserves justification on failed answer', () => {
  const out = materializeRemediationActions(Q_FAIL_NO, { value: 'No', justification: 'Skipped' });
  assert.equal(out.value, 'No');
  assert.equal(out.justification, 'Skipped');
  assert.equal(out.remediationActions?.length, 2);
});

test('materializeRemediationActions: strips remediationActions when answer becomes passing', () => {
  const stale = {
    value: 'Yes',
    remediationActions: [{ id: 'q-needs-ra-0', text: 'old', completed: false }],
  };
  const out = materializeRemediationActions(Q_FAIL_NO, stale);
  assert.equal(out.remediationActions, undefined);
  assert.equal(out.value, 'Yes');
});

test('materializeRemediationActions: returns answer unchanged when question has no remediationActions defined', () => {
  /** @type {QuestionDefinition} */
  const q = { id: 'q-x', text: 'q', responseType: 'yes-no-na', failureCriteria: 'No', deprecated: false };
  const ans = { value: 'No' };
  const out = materializeRemediationActions(q, ans);
  assert.equal(out.remediationActions, undefined);
});
