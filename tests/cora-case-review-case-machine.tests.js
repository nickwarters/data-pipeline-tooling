// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS_CONFIG,
  ATTRIBUTE_CONFIG,
  BASE_ROW,
  CaseMachine,
  EMPTY_CASE_TYPE_CONFIG,
  ENGLAND_WALES_HOLIDAYS,
  NO_CAPABILITIES,
  REMEDIATION_SLA_WORKING_DAYS,
  addWorkingDays,
  isReportable,
  machineForStatus,
} from './helpers/cora-case-review.js';

// Capability: case lifecycle and reportable milestones.

test('CaseMachine.transitionToCompleted stamps questionBankVersion when provided', () => {
  const machine = new CaseMachine(
    BASE_ROW,
    { id: 'u1' },
    NO_CAPABILITIES,
    EMPTY_CASE_TYPE_CONFIG
  );
  const fields = machine.transitionToCompleted(
    null,
    undefined,
    'sha256:aabbccdd'
  );
  assert.equal(
    fields.questionBankVersion,
    'sha256:aabbccdd',
    'questionBankVersion is included in the PATCH fields'
  );
});

test('CaseMachine.transitionToCompleted omits questionBankVersion when null', () => {
  const machine = new CaseMachine(
    BASE_ROW,
    { id: 'u1' },
    NO_CAPABILITIES,
    EMPTY_CASE_TYPE_CONFIG
  );
  const fields = machine.transitionToCompleted(null, undefined, null);
  assert.equal(
    Object.hasOwn(fields, 'questionBankVersion'),
    false,
    'no questionBankVersion key when null'
  );
});

test('CaseMachine.transitionToCompleted omits questionBankVersion when not provided', () => {
  const machine = new CaseMachine(
    BASE_ROW,
    { id: 'u1' },
    NO_CAPABILITIES,
    EMPTY_CASE_TYPE_CONFIG
  );
  const fields = machine.transitionToCompleted(null, undefined);
  assert.equal(
    Object.hasOwn(fields, 'questionBankVersion'),
    false,
    'no questionBankVersion key when argument absent'
  );
});

test('isReportable: true from Actions In Progress and Completed, false while In-progress', () => {
  assert.equal(isReportable('In-progress'), false);
  assert.equal(isReportable('Actions In Progress'), true);
  assert.equal(isReportable('Completed'), true);
});

test('CaseMachine.reportable mirrors the status milestone', () => {
  assert.equal(machineForStatus('In-progress').reportable, false);
  assert.equal(machineForStatus('Actions In Progress').reportable, true);
  assert.equal(machineForStatus('Completed').reportable, true);
});

test('CaseMachine.canComplete is gated on the reportable predicate, not a hard-coded status', () => {
  assert.equal(
    machineForStatus('In-progress').canComplete,
    true,
    'the assigned Reviewer can complete while the Case is still editable'
  );
  assert.equal(
    machineForStatus('Actions In Progress').canComplete,
    false,
    'a reportable Case is frozen — the Summary button no longer completes it'
  );
  assert.equal(machineForStatus('Completed').canComplete, false);
});

test('CaseMachine.canAttribute / canCapture are gated on the reportable predicate', () => {
  assert.equal(
    machineForStatus('In-progress', ATTRIBUTE_CONFIG).canAttribute,
    true
  );
  assert.equal(
    machineForStatus('In-progress', ATTRIBUTE_CONFIG).canCapture,
    true
  );
  assert.equal(
    machineForStatus('Actions In Progress', ATTRIBUTE_CONFIG).canAttribute,
    false,
    'attribution freezes at the reportable milestone (Send Actions)'
  );
  assert.equal(
    machineForStatus('Completed', ATTRIBUTE_CONFIG).canAttribute,
    false
  );
});

test('CaseMachine.canSelectRemediation follows Issues edit access, not attributeFailures (issue #250)', () => {
  // Unlike canAttribute/canCapture, action selection does not require the Case
  // Type to opt into attributeFailures — EMPTY_CASE_TYPE_CONFIG has none.
  assert.equal(
    machineForStatus('In-progress').canSelectRemediation,
    true,
    'the assigned Reviewer may select actions while the Case is editable'
  );
  assert.equal(
    machineForStatus('Actions In Progress').canSelectRemediation,
    false,
    'selection freezes at the reportable milestone'
  );
  assert.equal(machineForStatus('Completed').canSelectRemediation, false);
});

test('CaseMachine.canCompleteRemediation gates the final close on the tracking tab (ADR-0024)', () => {
  const resolved = {
    'q-a': {
      value: 'No',
      capture: { acts: [{ id: 'a', text: 'x', status: 'complete' }] },
    },
  };
  const pending = {
    'q-a': {
      value: 'No',
      capture: { acts: [{ id: 'a', text: 'x', status: 'pending' }] },
    },
  };
  /**
   * @param {'In-progress'|'Actions In Progress'|'Completed'} status
   * @param {Record<string, any>} answers
   * @param {string} [reviewer]
   */
  const make = (status, answers, reviewer = 'u1') =>
    new CaseMachine(
      { ...BASE_ROW, status, assignedReviewer: reviewer, answers },
      { id: 'u1' },
      NO_CAPABILITIES,
      ACTIONS_CONFIG
    );

  assert.equal(
    make('Actions In Progress', resolved).canCompleteRemediation,
    true,
    'reviewer may close once every sent action is resolved'
  );
  assert.equal(
    make('Actions In Progress', pending).canCompleteRemediation,
    false,
    'blocked while an action is still pending'
  );
  assert.equal(
    make('In-progress', resolved).canCompleteRemediation,
    false,
    'inert before actions are sent (the tracking tab is not editable)'
  );
  assert.equal(
    make('Actions In Progress', resolved, 'other').canCompleteRemediation,
    false,
    'only the assigned reviewer closes it'
  );
});

test('CaseMachine.transitionToActionsInProgress stamps the reportable snapshot without completedAt (ADR-0023)', () => {
  const answers = {
    'q-needs': {
      value: 'No',
      remediationActions: [{ id: 'ra-0', text: 'Retrain.', completed: false }],
    },
  };
  /** @param {Record<string, any>} a */
  const computeOutcome = (a) =>
    /** @type {any} */ ({
      outcome: Object.values(a).some((x) => x.value === 'No') ? 'fail' : 'pass',
    });

  const fields = machineForStatus('In-progress').transitionToActionsInProgress(
    computeOutcome,
    answers,
    'sha256:v1'
  );

  assert.equal(fields.status, 'Actions In Progress');
  assert.equal(typeof fields.reportableAt, 'string', 'reportableAt is stamped');
  // The remediation SLA due date is stamped here, once, as reportableAt + 10
  // working days (ADR-0025) — a plain YYYY-MM-DD ISO date on the Case row.
  assert.match(
    String(fields.remediationDueDate),
    /^\d{4}-\d{2}-\d{2}$/,
    'remediationDueDate is a YYYY-MM-DD ISO date'
  );
  assert.equal(
    fields.remediationDueDate,
    addWorkingDays(
      String(fields.reportableAt),
      REMEDIATION_SLA_WORKING_DAYS,
      ENGLAND_WALES_HOLIDAYS
    ),
    'remediationDueDate = reportableAt + 10 working days'
  );
  assert.equal(
    Object.hasOwn(fields, 'completedAt'),
    false,
    'completedAt is NOT stamped on the actions path — the Case is not yet closed'
  );
  assert.equal(
    fields.outcomeAtCompletion,
    'fail',
    'outcome snapshot at reportable'
  );
  assert.equal(fields.hadRemediation, true);
  assert.equal(fields.effectiveOutcome, 'fail');
  assert.equal(fields.effectiveHadRemediation, true);
  assert.equal(fields.outcomeOverridden, false);
  assert.equal(fields.questionBankVersion, 'sha256:v1');
});

test('CaseMachine.transitionToCompleted (no-actions path) stamps reportableAt and completedAt together (ADR-0023)', () => {
  const fields = machineForStatus('In-progress').transitionToCompleted(
    () => ({ outcome: 'pass' }),
    { 'q-welcome': { value: 'Yes' } },
    null
  );

  assert.equal(fields.status, 'Completed');
  assert.equal(typeof fields.reportableAt, 'string');
  assert.equal(
    fields.reportableAt,
    fields.completedAt,
    'on the no-actions path reportableAt === completedAt'
  );
  assert.equal(fields.outcomeAtCompletion, 'pass', 'snapshot taken here');
  assert.equal(fields.hadRemediation, false);
  assert.equal(
    Object.hasOwn(fields, 'remediationDueDate'),
    false,
    'no remediation SLA due date on the no-actions path (ADR-0025)'
  );
});

test('CaseMachine.transitionToFinalComplete closes without re-snapshotting (ADR-0023)', () => {
  const fields = machineForStatus(
    'Actions In Progress'
  ).transitionToFinalComplete();

  assert.equal(fields.status, 'Completed');
  assert.equal(
    typeof fields.completedAt,
    'string',
    'completedAt stamped at final close'
  );
  assert.equal(
    Object.hasOwn(fields, 'reportableAt'),
    false,
    'reportableAt was already stamped at Send Actions — not re-stamped'
  );
  assert.equal(
    Object.hasOwn(fields, 'outcomeAtCompletion'),
    false,
    'the outcome was frozen at reportable — no re-snapshot at final complete'
  );
});
