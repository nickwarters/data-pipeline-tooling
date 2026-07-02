// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  countConfiguredFailures,
  isFailure,
  materializeRemediationActions,
} from '../src/evaluators/failure-evaluator.js';

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/** @type {QuestionDefinition} */
const Q_FAIL_NO = {
  id: 'q-needs',
  text: "Were the customer's needs identified?",
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

// ===== countConfiguredFailures =====

test('countConfiguredFailures: ignores No answers for questions with no failureCriteria', () => {
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

test('countConfiguredFailures: counts answers matching configured failureCriteria', () => {
  const questions = [Q_FAIL_NO, Q_NO_CRITERIA, Q_MULTI];
  const answers = {
    [Q_FAIL_NO.id]: { value: 'No' },
    [Q_NO_CRITERIA.id]: { value: 'Email' },
    [Q_MULTI.id]: { value: ['Account', 'Billing'] },
  };

  assert.equal(countConfiguredFailures(questions, answers), 2);
});

// ===== materializeRemediationActions =====

test('materializeRemediationActions: leaves no selected actions on a newly failed answer', () => {
  const out = materializeRemediationActions(Q_FAIL_NO, { value: 'No' });
  assert.equal(out.remediationActions, undefined);
});

test('materializeRemediationActions: preserves justification on failed answer', () => {
  const out = materializeRemediationActions(Q_FAIL_NO, {
    value: 'No',
    justification: 'Skipped',
  });
  assert.equal(out.value, 'No');
  assert.equal(out.justification, 'Skipped');
  assert.equal(out.remediationActions, undefined);
});

test('materializeRemediationActions: preserves selected actions on a still-failing answer', () => {
  const out = materializeRemediationActions(Q_FAIL_NO, {
    value: 'No',
    remediationActions: [
      { id: 'q-needs-ra-1', text: 'Update script.', completed: false },
    ],
  });
  assert.deepEqual(out.remediationActions, [
    { id: 'q-needs-ra-1', text: 'Update script.', completed: false },
  ]);
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

test('materializeRemediationActions: retains freeFormRemediation on a still-failing answer (issue #250)', () => {
  const out = materializeRemediationActions(Q_FAIL_NO, {
    value: 'No',
    freeFormRemediation: 'Escalate to legal',
  });
  assert.equal(out.freeFormRemediation, 'Escalate to legal');
});

test('materializeRemediationActions: strips freeFormRemediation when answer becomes passing (issue #250)', () => {
  const out = materializeRemediationActions(Q_FAIL_NO, {
    value: 'Yes',
    freeFormRemediation: 'Escalate to legal',
    remediationActions: [{ id: 'q-needs-ra-0', text: 'old', completed: false }],
  });
  assert.equal(out.freeFormRemediation, undefined);
  assert.equal(out.remediationActions, undefined);
  assert.equal(out.value, 'Yes');
});

test('materializeRemediationActions: returns answer unchanged when question has no remediationActions defined', () => {
  /** @type {QuestionDefinition} */
  const q = {
    id: 'q-x',
    text: 'q',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    deprecated: false,
  };
  const ans = { value: 'No' };
  const out = materializeRemediationActions(q, ans);
  assert.equal(out.remediationActions, undefined);
});

// ===== Attributed Party stripping (ADR-0013) =====

test('materializeRemediationActions: strips attributedParty when answer becomes passing', () => {
  const stale = {
    value: 'Yes',
    attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
  };
  const out = materializeRemediationActions(Q_FAIL_NO, stale);
  assert.equal(out.attributedParty, undefined);
  assert.equal(out.value, 'Yes');
});

test('materializeRemediationActions: strips both attributedParty and remediationActions when answer becomes passing', () => {
  const stale = {
    value: 'Yes',
    remediationActions: [{ id: 'q-needs-ra-0', text: 'old', completed: false }],
    attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
  };
  const out = materializeRemediationActions(Q_FAIL_NO, stale);
  assert.equal(out.attributedParty, undefined);
  assert.equal(out.remediationActions, undefined);
});

test('materializeRemediationActions: retains attributedParty on a still-failing answer', () => {
  const ans = {
    value: 'No',
    attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
  };
  const out = materializeRemediationActions(Q_FAIL_NO, ans);
  assert.deepEqual(out.attributedParty, {
    loginName: 'jsmith',
    displayName: 'Jane Smith',
  });
});

test('materializeRemediationActions: retains attributedParty on a still-failing answer with no remediationActions defined', () => {
  /** @type {QuestionDefinition} */
  const q = {
    id: 'q-x',
    text: 'q',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    deprecated: false,
  };
  const ans = {
    value: 'No',
    attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
  };
  const out = materializeRemediationActions(q, ans);
  assert.deepEqual(out.attributedParty, {
    loginName: 'jsmith',
    displayName: 'Jane Smith',
  });
});

// ===== Remediation Details stripping (ADR-0017, shares ADR-0013 lifecycle) =====

test('materializeRemediationActions: strips remediationDetails when answer becomes passing', () => {
  const stale = {
    value: 'Yes',
    remediationDetails: { rootCause: 'Rushed', severity: 'High' },
  };
  const out = materializeRemediationActions(Q_FAIL_NO, stale);
  assert.equal(out.remediationDetails, undefined);
  assert.equal(out.value, 'Yes');
});

test('materializeRemediationActions: retains remediationDetails on a still-failing answer', () => {
  const ans = {
    value: 'No',
    remediationDetails: { rootCause: 'Rushed' },
  };
  const out = materializeRemediationActions(Q_FAIL_NO, ans);
  assert.deepEqual(out.remediationDetails, { rootCause: 'Rushed' });
});

test('materializeRemediationActions: strips remediationDetails alongside attributedParty when passing with no remediationActions defined', () => {
  /** @type {QuestionDefinition} */
  const q = {
    id: 'q-x',
    text: 'q',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    deprecated: false,
  };
  const stale = {
    value: 'Yes',
    attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
    remediationDetails: { rootCause: 'Rushed' },
  };
  const out = materializeRemediationActions(q, stale);
  assert.equal(out.attributedParty, undefined);
  assert.equal(out.remediationDetails, undefined);
});

// ===== Issue Capture stripping (ADR-0020, shares ADR-0013 lifecycle) =====

test('materializeRemediationActions: strips capture when answer becomes passing', () => {
  const stale = {
    value: 'Yes',
    capture: { rootCause: 'Rushed', severity: 'High' },
  };
  const out = materializeRemediationActions(Q_FAIL_NO, stale);
  assert.equal(out.capture, undefined);
  assert.equal(out.value, 'Yes');
});

test('materializeRemediationActions: retains capture on a still-failing answer', () => {
  const ans = { value: 'No', capture: { rootCause: 'Rushed' } };
  const out = materializeRemediationActions(Q_FAIL_NO, ans);
  assert.deepEqual(out.capture, { rootCause: 'Rushed' });
});
