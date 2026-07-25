// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaseMachine, isReportable } from '../src/lib/case-machine.js';
import { addWorkingDays } from '../src/lib/add-working-days.js';
import {
  ENGLAND_WALES_HOLIDAYS,
  REMEDIATION_SLA_WORKING_DAYS,
} from '../src/config/working-days.js';

/** @type {import('../src/services/permissions.js').Capabilities} */
const NO_CAPABILITIES = {
  isReviewer: false,
  ownedCaseTypes: [],
  isAdviser: false,
  isReviewerManager: false,
  isResponsiblePartyManager: false,
  isMaintainer: false,
  listAccessCaseTypes: [],
  ownedJourneyCaseTypes: [],
  isControls: false,
  isVisitor: true,
};

/** @type {import('../src/sharepoint-client.js').CaseRow} */
const BASE_ROW = {
  id: 'c1',
  caseType: 'example-review',
  title: 'Test Case',
  status: 'In-progress',
  assignedReviewer: 'u1',
  responsibleParty: 'u2',
  answers: {},
  conversation: [],
  notes: '',
  completedAt: null,
  etag: 'e1',
};

/** @type {import('../src/sharepoint-client.js').CaseTypeConfig} */
const EMPTY_CONFIG = {
  questions: [],
  computeOutcome: () => ({ outcome: 'pass' }),
  outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
  defaultOutcomeId: 'pass',
};

/** @type {import('../src/sharepoint-client.js').CaseTypeConfig} */
const ATTRIBUTE_CONFIG = { ...EMPTY_CONFIG, attributeFailures: true };

/** @type {import('../src/sharepoint-client.js').CaseTypeConfig} */
const ACTIONS_CONFIG = {
  ...EMPTY_CONFIG,
  captureGroups: [
    {
      key: 'g',
      label: 'G',
      fields: [{ key: 'acts', label: 'Acts', type: 'actions' }],
    },
  ],
};

/**
 * @param {'In-progress'|'Actions In Progress'|'Completed'} status
 * @param {import('../src/sharepoint-client.js').CaseTypeConfig} [config]
 * @param {Partial<import('../src/sharepoint-client.js').CaseRow>} [overrides]
 */
function machineFor(status, config = EMPTY_CONFIG, overrides = {}) {
  return new CaseMachine(
    { ...BASE_ROW, status, ...overrides },
    { id: 'u1' },
    NO_CAPABILITIES,
    config
  );
}

test('CaseMachine stamps questionBankVersion only when supplied', () => {
  const machine = machineFor('In-progress');
  assert.equal(
    machine.transitionToCompleted(null, undefined, 'sha256:aabbccdd')
      .questionBankVersion,
    'sha256:aabbccdd'
  );
  assert.equal(
    Object.hasOwn(
      machine.transitionToCompleted(null, undefined, null),
      'questionBankVersion'
    ),
    false
  );
  assert.equal(
    Object.hasOwn(
      machine.transitionToCompleted(null, undefined),
      'questionBankVersion'
    ),
    false
  );
});

test('CaseMachine lifecycle capabilities freeze at the reportable milestone', () => {
  assert.equal(isReportable('In-progress'), false);
  assert.equal(isReportable('Actions In Progress'), true);
  assert.equal(isReportable('Completed'), true);

  assert.equal(machineFor('In-progress').reportable, false);
  assert.equal(machineFor('Actions In Progress').reportable, true);
  assert.equal(machineFor('Completed').reportable, true);
  assert.equal(machineFor('In-progress').canComplete, true);
  assert.equal(machineFor('Actions In Progress').canComplete, false);
  assert.equal(machineFor('Completed').canComplete, false);
});

test('CaseMachine attribution freezes at reportable while remediation selection follows Issues edit access', () => {
  assert.equal(machineFor('In-progress', ATTRIBUTE_CONFIG).canAttribute, true);
  assert.equal(machineFor('In-progress', ATTRIBUTE_CONFIG).canCapture, true);
  assert.equal(
    machineFor('Actions In Progress', ATTRIBUTE_CONFIG).canAttribute,
    false
  );
  assert.equal(machineFor('Completed', ATTRIBUTE_CONFIG).canAttribute, false);

  assert.equal(machineFor('In-progress').canSelectRemediation, true);
  assert.equal(machineFor('Actions In Progress').canSelectRemediation, false);
  assert.equal(machineFor('Completed').canSelectRemediation, false);
});

test('CaseMachine permits the final close only for the Assigned Reviewer of an Actions In Progress Case (#499)', () => {
  // The *content* half of the gate — every Question's remediation resolved —
  // lives in completionControl/completionPatch, which see the live Answers.
  /** @type {Record<string, import('../src/sharepoint-client.js').Answer>} */
  const answers = {
    'q-a': {
      value: 'No',
      remediationActions: [{ id: 'a1', text: 'Call back', completed: false }],
    },
  };

  assert.equal(
    machineFor('Actions In Progress', ACTIONS_CONFIG, { answers })
      .mayResolveRemediation,
    true
  );
  assert.equal(
    machineFor('In-progress', ACTIONS_CONFIG, { answers })
      .mayResolveRemediation,
    false,
    'nothing to close before the actions are sent'
  );
  assert.equal(
    machineFor('Completed', ACTIONS_CONFIG, { answers }).mayResolveRemediation,
    false,
    'and nothing to close once the Case is closed'
  );
  assert.equal(
    machineFor('Actions In Progress', ACTIONS_CONFIG, {
      answers,
      assignedReviewer: 'other',
    }).mayResolveRemediation,
    false
  );
});

test('CaseMachine Send Actions stamps the reportable snapshot without completedAt (ADR-0023)', () => {
  const answers = {
    'q-needs': {
      value: 'No',
      remediationActions: [{ id: 'ra-0', text: 'Retrain.', completed: false }],
    },
  };
  const fields = machineFor('In-progress').transitionToActionsInProgress(
    () => ({ outcome: 'fail' }),
    answers,
    'sha256:v1'
  );

  assert.equal(fields.status, 'Actions In Progress');
  assert.equal(typeof fields.reportableAt, 'string');
  assert.equal(
    fields.remediationDueDate,
    addWorkingDays(
      String(fields.reportableAt),
      REMEDIATION_SLA_WORKING_DAYS,
      ENGLAND_WALES_HOLIDAYS
    )
  );
  assert.equal(Object.hasOwn(fields, 'completedAt'), false);
  assert.equal(fields.outcomeAtCompletion, 'fail');
  assert.equal(fields.hadRemediation, true);
  assert.equal(fields.effectiveOutcome, 'fail');
  assert.equal(fields.effectiveHadRemediation, true);
  assert.equal(fields.outcomeOverridden, false);
  assert.equal(fields.questionBankVersion, 'sha256:v1');
});

test('CaseMachine no-actions completion stamps reportable and completed together', () => {
  const fields = machineFor('In-progress').transitionToCompleted(
    () => ({ outcome: 'pass' }),
    { 'q-welcome': { value: 'Yes' } },
    null
  );

  assert.equal(fields.status, 'Completed');
  assert.equal(typeof fields.reportableAt, 'string');
  assert.equal(fields.reportableAt, fields.completedAt);
  assert.equal(fields.outcomeAtCompletion, 'pass');
  assert.equal(fields.hadRemediation, false);
  assert.equal(Object.hasOwn(fields, 'remediationDueDate'), false);
});

test('CaseMachine final close does not re-snapshot the reportable outcome', () => {
  const fields = machineFor('Actions In Progress').transitionToFinalComplete();

  assert.equal(fields.status, 'Completed');
  assert.equal(typeof fields.completedAt, 'string');
  assert.equal(Object.hasOwn(fields, 'reportableAt'), false);
  assert.equal(Object.hasOwn(fields, 'outcomeAtCompletion'), false);
});
