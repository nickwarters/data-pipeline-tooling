// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  countConfiguredFailures,
  deriveFailureValues,
  isFailure,
  materializeRemediationActions,
  withDerivedFailureValues,
} from '../src/evaluators/failure-evaluator.js';

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/** @type {QuestionDefinition} */
const Q_FAIL_NO = {
  id: 'q-needs',
  text: "Were the customer's needs identified?",
  responseType: 'yes-no-na',
  optionOutcomes: { No: 'fail' },
  failureValues: ['No'],
  remediationActions: ['Retrain agent.', 'Update script.'],
  deprecated: false,
};

/** @type {QuestionDefinition} */
const Q_INFORMATIONAL = {
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
  optionOutcomes: { Billing: 'refer' },
  failureValues: ['Billing'],
  remediationActions: ['Refer to billing team.'],
  deprecated: false,
};

/** @type {QuestionDefinition} */
const Q_GRADED = {
  id: 'q-letter',
  text: 'Is the letter structure correct?',
  responseType: 'single-choice',
  options: ['Minor', 'Impactful', 'Harmful'],
  optionOutcomes: { Impactful: 'refer', Harmful: 'fail' },
  failureValues: ['Impactful', 'Harmful'],
  deprecated: false,
};

// ===== deriveFailureValues =====

test('deriveFailureValues: every option mapped to a non-default Outcome fails', () => {
  assert.deepEqual(deriveFailureValues(Q_GRADED, 'pass'), [
    'Impactful',
    'Harmful',
  ]);
});

test('deriveFailureValues: options mapped to the default Outcome do not fail', () => {
  /** @type {QuestionDefinition} */
  const q = {
    id: 'q-outcome',
    text: 'Overall verdict?',
    responseType: 'outcome',
    options: ['Pass', 'Refer', 'Fail'],
    optionOutcomes: { Pass: 'pass', Refer: 'refer', Fail: 'fail' },
    deprecated: false,
  };
  assert.deepEqual(deriveFailureValues(q, 'pass'), ['Refer', 'Fail']);
});

test('deriveFailureValues: unmapped options never fail', () => {
  assert.deepEqual(deriveFailureValues(Q_INFORMATIONAL, 'pass'), []);
});

test('deriveFailureValues: N/A never fails even when explicitly mapped', () => {
  /** @type {QuestionDefinition} */
  const q = {
    id: 'q-na-mapped',
    text: 'Legacy N/A mapping?',
    responseType: 'yes-no-na',
    optionOutcomes: { No: 'fail', NA: 'fail' },
    deprecated: false,
  };
  assert.deepEqual(deriveFailureValues(q, 'pass'), ['No']);
});

// ===== withDerivedFailureValues =====

test('withDerivedFailureValues: annotates questions that can fail and leaves the rest untouched', () => {
  const { failureValues: _drop, ...bare } = Q_GRADED;
  const [graded, informational] = withDerivedFailureValues(
    [bare, Q_INFORMATIONAL],
    'pass'
  );
  assert.deepEqual(graded.failureValues, ['Impactful', 'Harmful']);
  assert.equal(informational, Q_INFORMATIONAL);
  // Input is not mutated.
  assert.equal('failureValues' in bare, false);
});

test('withDerivedFailureValues: strips a stale annotation when nothing can fail', () => {
  /** @type {QuestionDefinition} */
  const stale = { ...Q_INFORMATIONAL, failureValues: ['Phone'] };
  const [out] = withDerivedFailureValues([stale], 'pass');
  assert.equal('failureValues' in out, false);
});

// ===== isFailure =====

test('isFailure: returns false when question has no failure values', () => {
  assert.equal(isFailure(Q_INFORMATIONAL, { value: 'Phone' }), false);
});

test('isFailure: returns false when answer is undefined', () => {
  assert.equal(isFailure(Q_FAIL_NO, undefined), false);
});

test('isFailure: returns true when the value maps to a non-default Outcome', () => {
  assert.equal(isFailure(Q_FAIL_NO, { value: 'No' }), true);
});

test('isFailure: every non-default graded option is a failure', () => {
  assert.equal(isFailure(Q_GRADED, { value: 'Impactful' }), true);
  assert.equal(isFailure(Q_GRADED, { value: 'Harmful' }), true);
  assert.equal(isFailure(Q_GRADED, { value: 'Minor' }), false);
});

test('isFailure: returns false for passing and N/A values', () => {
  assert.equal(isFailure(Q_FAIL_NO, { value: 'Yes' }), false);
  assert.equal(isFailure(Q_FAIL_NO, { value: 'NA' }), false);
});

test('isFailure: N/A is never a failure even when listed in failureValues', () => {
  /** @type {QuestionDefinition} */
  const q = { ...Q_FAIL_NO, failureValues: ['No', 'NA'] };
  assert.equal(isFailure(q, { value: 'NA' }), false);
  assert.equal(isFailure(q, { value: ['NA'] }), false);
});

test('isFailure: scalar values require equality rather than substring matching', () => {
  assert.equal(
    isFailure({ ...Q_FAIL_NO, failureValues: ['N'] }, { value: 'No' }),
    false
  );
});

test('isFailure: returns true when array value includes a failure value', () => {
  assert.equal(isFailure(Q_MULTI, { value: ['Account', 'Billing'] }), true);
});

test('isFailure: returns false when array value includes no failure value', () => {
  assert.equal(isFailure(Q_MULTI, { value: ['Account', 'Support'] }), false);
});

test('isFailure: returns false for empty array', () => {
  assert.equal(isFailure(Q_MULTI, { value: [] }), false);
});

// ===== countConfiguredFailures =====

test('countConfiguredFailures: ignores No answers on informational questions', () => {
  /** @type {QuestionDefinition[]} */
  const questions = [
    {
      id: 'q-general-info',
      text: 'Was the case context reviewed?',
      category: 'General',
      responseType: 'yes-no-na',
      deprecated: false,
    },
  ];
  const answers = {
    'q-general-info': { value: 'No' },
  };

  assert.equal(countConfiguredFailures(questions, answers), 0);
});

test('countConfiguredFailures: counts answers hitting derived failure values', () => {
  const questions = [Q_FAIL_NO, Q_INFORMATIONAL, Q_MULTI];
  const answers = {
    [Q_FAIL_NO.id]: { value: 'No' },
    [Q_INFORMATIONAL.id]: { value: 'Email' },
    [Q_MULTI.id]: { value: ['Account', 'Billing'] },
  };

  assert.equal(countConfiguredFailures(questions, answers), 2);
});

// ===== materializeRemediationActions =====

test('materializeRemediationActions: leaves no selected actions on a newly failed answer', () => {
  const out = materializeRemediationActions(Q_FAIL_NO, { value: 'No' });
  assert.deepEqual(out.remediationActions, undefined);
});

test('materializeRemediationActions: preserves justification on failed answer', () => {
  const out = materializeRemediationActions(Q_FAIL_NO, {
    value: 'No',
    justification: 'Customer asked twice.',
  });
  assert.equal(out.justification, 'Customer asked twice.');
});

test('materializeRemediationActions: preserves selected actions on a still-failing answer', () => {
  const out = materializeRemediationActions(Q_FAIL_NO, {
    value: 'No',
    remediationActions: [{ id: 'q-needs-ra-0', text: 'Retrain agent.' }],
  });
  assert.equal(out.remediationActions?.length, 1);
  assert.equal(out.remediationActions?.[0].text, 'Retrain agent.');
});

test('materializeRemediationActions: strips remediationActions when answer becomes passing', () => {
  const stale = {
    value: 'Yes',
    remediationActions: [{ id: 'q-needs-ra-0', text: 'Retrain agent.' }],
  };
  const out = materializeRemediationActions(Q_FAIL_NO, stale);
  assert.equal('remediationActions' in out, false);
});

test('materializeRemediationActions: retains remediationStatus on a still-failing answer', () => {
  const out = materializeRemediationActions(Q_FAIL_NO, {
    value: 'No',
    remediationActions: [{ id: 'q-needs-ra-0', text: 'Retrain agent.' }],
    remediationStatus: { status: 'complete' },
  });
  assert.deepEqual(out.remediationStatus, { status: 'complete' });
});

test('materializeRemediationActions: strips remediationStatus when answer becomes passing', () => {
  // The resolution shares the failure lifecycle with the remediation it resolves.
  // Left behind, a re-failed Answer would render pre-resolved and the completion
  // gate would count it as done.
  const out = materializeRemediationActions(Q_FAIL_NO, {
    value: 'Yes',
    remediationStatus: { status: 'partial', details: 'Two of three done' },
  });
  assert.equal('remediationStatus' in out, false);
});

test('materializeRemediationActions: retains freeFormRemediation on a still-failing answer', () => {
  const out = materializeRemediationActions(Q_FAIL_NO, {
    value: 'No',
    freeFormRemediation: 'Call the customer back.',
  });
  assert.equal(out.freeFormRemediation, 'Call the customer back.');
});

test('materializeRemediationActions: strips freeFormRemediation when answer becomes passing', () => {
  const out = materializeRemediationActions(Q_FAIL_NO, {
    value: 'Yes',
    freeFormRemediation: 'Call the customer back.',
  });
  assert.equal('freeFormRemediation' in out, false);
});

test('materializeRemediationActions: retains remediationRequired on a still-failing answer', () => {
  const out = materializeRemediationActions(Q_FAIL_NO, {
    value: 'No',
    remediationRequired: 'no',
  });
  assert.equal(out.remediationRequired, 'no');
});

test('materializeRemediationActions: strips remediationRequired when answer becomes passing', () => {
  // A decision left behind would silently satisfy the completion gate the
  // moment the Answer failed again, with nobody having looked at it — the same
  // argument that strips a stale remediationStatus.
  const out = materializeRemediationActions(Q_FAIL_NO, {
    value: 'Yes',
    remediationRequired: 'no',
  });
  assert.equal('remediationRequired' in out, false);
});

test('materializeRemediationActions: returns answer unchanged when question has no remediationActions defined', () => {
  /** @type {QuestionDefinition} */
  const q = {
    id: 'q-simple',
    text: 'Simple?',
    responseType: 'yes-no-na',
    optionOutcomes: { No: 'fail' },
    failureValues: ['No'],
    deprecated: false,
  };
  const ans = { value: 'No' };
  const out = materializeRemediationActions(q, ans);
  assert.deepEqual(out, ans);
});

test('materializeRemediationActions: strips both capture and remediationActions when answer becomes passing', () => {
  const stale = {
    value: 'Yes',
    capture: {
      attributedTo: { loginName: 'dev\\alex', displayName: 'Alex Doe' },
    },
    remediationActions: [{ id: 'q-needs-ra-0', text: 'Retrain agent.' }],
  };
  const out = materializeRemediationActions(Q_FAIL_NO, stale);
  assert.equal('capture' in out, false);
  assert.equal('remediationActions' in out, false);
});

test('materializeRemediationActions: retains capture on a still-failing answer with no remediationActions defined', () => {
  /** @type {QuestionDefinition} */
  const q = {
    id: 'q-simple',
    text: 'Simple?',
    responseType: 'yes-no-na',
    optionOutcomes: { No: 'fail' },
    failureValues: ['No'],
    deprecated: false,
  };
  const ans = {
    value: 'No',
    capture: { rootCause: 'Rushed' },
  };
  const out = materializeRemediationActions(q, ans);
  assert.deepEqual(out.capture, { rootCause: 'Rushed' });
});

test('materializeRemediationActions: strips capture when answer becomes passing', () => {
  const stale = {
    value: 'Yes',
    capture: { severity: 'High' },
  };
  const out = materializeRemediationActions(Q_FAIL_NO, stale);
  assert.equal('capture' in out, false);
});

test('materializeRemediationActions: retains capture on a still-failing answer', () => {
  const ans = { value: 'No', capture: { severity: 'High' } };
  const out = materializeRemediationActions(Q_FAIL_NO, ans);
  assert.deepEqual(out.capture, { severity: 'High' });
});
