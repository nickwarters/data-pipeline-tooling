// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaseMachine } from '../src/lib/case-machine.js';
import { isReportable } from '../src/evaluators/case-lifecycle.js';
import { CASE_STATUS } from '../src/lib/case-statuses.js';
import { addWorkingDays } from '../src/lib/add-working-days.js';
import {
  ENGLAND_WALES_HOLIDAYS,
  REMEDIATION_SLA_WORKING_DAYS,
} from '../src/config/working-days.js';
import { makeCaseRow } from './helpers/fixtures.js';
import { configureAppSections } from './helpers/configure-sections.js';

configureAppSections();

const BASE_ROW = makeCaseRow({
  id: 'c1',
  caseType: 'example-review',
  title: 'Test Case',
  assignedReviewer: 'u1',
  responsibleParty: 'u2',
  etag: 'e1',
});

/** @type {import('../src/sharepoint-client.js').CaseTypeConfig} */
const EMPTY_CONFIG = {
  questions: [],
  computeOutcome: () => ({ outcome: 'pass' }),
  outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
  defaultOutcomeId: 'pass',
};

// The Remediation Section used to be gated on a Case Type declaring an
// `actions`-typed Issue Capture Field. Tracking moved to
// `answer.remediationStatus` and `'actions'` is no longer declarable, so the
// remediation gate is exercised against a Case Type with no capture groups at
// all — which is every real Case Type.
const ACTIONS_CONFIG = EMPTY_CONFIG;

/**
 * The Case's resolved catalogue. Whether a Case carries remediation is a
 * question about the tab's *rows*, so every Question these tests answer has to
 * be in it and able to fail.
 *
 * @type {import('../src/sharepoint-client.js').QuestionDefinition[]}
 */
const CATALOGUE = ['q-a', 'q-needs', 'q-welcome'].map((id) => ({
  id,
  text: id,
  responseType: /** @type {const} */ ('yes-no-na'),
  failureValues: ['No'],
  deprecated: false,
}));

/**
 * @param {import('../src/lib/case-statuses.js').CaseStatus} status
 * @param {import('../src/sharepoint-client.js').CaseTypeConfig} [config]
 * @param {Partial<import('../src/sharepoint-client.js').CaseRow>} [overrides]
 * @param {import('../src/sharepoint-client.js').QuestionDefinition[]} [catalogue]
 */
function machineFor(
  status,
  config = EMPTY_CONFIG,
  overrides = {},
  catalogue = CATALOGUE
) {
  return new CaseMachine(
    { ...BASE_ROW, status, ...overrides },
    { id: 'u1' },
    config,
    { catalogue }
  );
}

test('CaseMachine reports whether the Case has passed the reportable milestone', () => {
  assert.equal(machineFor('In-progress').reportable, false);
  assert.equal(machineFor('Actions In Progress').reportable, true);
  assert.equal(machineFor('Completed').reportable, true);
  // Void freezes the Case without ever making it reportable, so the freeze is
  // its own question rather than something read off this.
  assert.equal(machineFor('Void').reportable, false);
  assert.equal(isReportable('In-progress'), false);
});

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

test('CaseMachine void stamps the terminal fields and no Outcome', () => {
  const machine = new CaseMachine(
    { ...BASE_ROW, status: 'In-progress', onHold: true },
    { id: 'u1' },
    EMPTY_CONFIG,
    { catalogue: CATALOGUE, now: () => new Date('2026-03-04T09:00:00Z') }
  );

  const fields = machine.transitionToVoid('duplicate');

  assert.deepEqual(fields, {
    status: 'Void',
    voidReason: 'duplicate',
    // A keyed reason names itself, so the note is explicitly nothing rather
    // than an empty string a reader would have to interpret.
    voidReasonNote: null,
    voidedAt: '2026-03-04T09:00:00.000Z',
    voidedBy: 'u1',
    onHold: false,
    placedOnHoldAt: null,
    awaitingResponsibleParty: false,
    awaitingSince: null,
  });
  for (const key of [
    'outcomeAtCompletion',
    'effectiveOutcome',
    'reportableAt',
    'completedAt',
    'hadRemediation',
  ]) {
    assert.equal(Object.hasOwn(fields, key), false, key);
  }
});

test('CaseMachine void records the words written under a reason that has no meaning alone', () => {
  const machine = new CaseMachine(
    { ...BASE_ROW, status: 'In-progress' },
    { id: 'u1' },
    EMPTY_CONFIG,
    { catalogue: CATALOGUE, now: () => new Date('2026-03-04T09:00:00Z') }
  );

  assert.equal(
    machine.transitionToVoid('other', '  the file was destroyed  ')
      .voidReasonNote,
    'the file was destroyed'
  );
  // Whitespace is not a written reason; the control gates on the same rule, so
  // this is the second half of one guard rather than a second guard.
  assert.equal(machine.transitionToVoid('other', '   ').voidReasonNote, null);
});

test('CaseMachine Send Actions stamps the reportable snapshot without completedAt', () => {
  const answers = {
    'q-needs': {
      value: 'No',
      remediationActions: [{ id: 'ra-0', text: 'Retrain.' }],
    },
  };
  const fields = machineFor('In-progress').transitionToActionsInProgress(
    () => ({ outcome: 'fail' }),
    answers,
    'sha256:v1'
  );

  assert.equal(fields.status, CASE_STATUS.ACTIONS_IN_PROGRESS);
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
  assert.equal(fields.awaitingResponsibleParty, true);
  assert.equal(fields.awaitingSince, fields.reportableAt);
  assert.equal(fields.outcomeAtCompletion, 'fail');
  assert.equal(fields.hadRemediation, true);
  assert.equal(fields.effectiveOutcome, 'fail');
  assert.equal(fields.effectiveHadRemediation, true);
  assert.equal(fields.outcomeOverridden, false);
  assert.equal(fields.questionBankVersion, 'sha256:v1');
});

test('CaseMachine Send Actions honours the Case Type remediation SLA in working days', () => {
  const machine = machineFor('In-progress', {
    ...EMPTY_CONFIG,
    remediationSlaWorkingDays: 5,
  });
  const fields = machine.transitionToActionsInProgress(
    () => ({ outcome: 'fail' }),
    {
      'q-needs': {
        value: 'No',
        remediationActions: [{ id: 'ra-0', text: 'x' }],
      },
    },
    null
  );

  assert.equal(
    fields.remediationDueDate,
    addWorkingDays(String(fields.reportableAt), 5, ENGLAND_WALES_HOLIDAYS)
  );
  // …and that is genuinely earlier than the framework default would have given.
  assert.notEqual(
    fields.remediationDueDate,
    addWorkingDays(
      String(fields.reportableAt),
      REMEDIATION_SLA_WORKING_DAYS,
      ENGLAND_WALES_HOLIDAYS
    )
  );
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

test('CaseMachine snapshots hadRemediation from free-form remediation too', () => {
  const fields = machineFor('In-progress').transitionToActionsInProgress(
    () => ({ outcome: 'fail' }),
    { 'q-welcome': { value: 'No', freeFormRemediation: 'Call back' } },
    null
  );
  assert.equal(fields.hadRemediation, true);
  assert.equal(fields.effectiveHadRemediation, true);
});

test('CaseMachine does not stamp hadRemediation for a Question that has left the catalogue', () => {
  // A Maintainer deprecated the Question after the Reviewer typed the
  // remediation — the operation CLAUDE.md mandates instead of deletion. The
  // Answer keeps the text, but the Remediation tab has no row for it, so the
  // Case does not go down the actions path and is not reported as having had
  // remediation. Its Reviewer sees "Complete Case", not an SLA nobody can close.
  const orphaned = {
    'q-welcome': { value: 'No', freeFormRemediation: 'Refund the customer' },
  };
  const deprecated = CATALOGUE.map((q) =>
    q.id === 'q-welcome' ? { ...q, deprecated: true } : q
  );
  const machine = machineFor('In-progress', EMPTY_CONFIG, {}, deprecated);

  const fields = machine.transitionToActionsInProgress(
    () => ({ outcome: 'fail' }),
    orphaned,
    null
  );
  assert.equal(fields.hadRemediation, false);
  assert.equal(fields.effectiveHadRemediation, false);

  // The other half — that the Section it would have been resolved on is not
  // offered either — is an access question, and lives with the permissions.
});

test('CaseMachine stamps every lifecycle timestamp from the injected clock', () => {
  const now = () => new Date('2026-07-23T09:30:00.000Z');
  /** @param {'In-progress'|'Actions In Progress'} status */
  const machine = (status) =>
    new CaseMachine({ ...BASE_ROW, status }, { id: 'u1' }, EMPTY_CONFIG, {
      now,
    });

  const sendActions = machine('In-progress').transitionToActionsInProgress(
    null,
    undefined,
    null
  );
  assert.equal(sendActions.reportableAt, '2026-07-23T09:30:00.000Z');
  // The SLA start moves with the clock; the working-day arithmetic behind it
  // does not (the holiday list stays frozen).
  assert.equal(sendActions.remediationDueDate, '2026-08-06');
  assert.equal(sendActions.awaitingSince, '2026-07-23T09:30:00.000Z');

  const completed = machine('In-progress').transitionToCompleted(
    null,
    undefined,
    null
  );
  assert.equal(completed.reportableAt, '2026-07-23T09:30:00.000Z');
  assert.equal(completed.completedAt, '2026-07-23T09:30:00.000Z');

  assert.equal(
    machine('Actions In Progress').transitionToFinalComplete().completedAt,
    '2026-07-23T09:30:00.000Z'
  );
});

test('CaseMachine closing a Case stops it awaiting the frontline', () => {
  // Both routes to Completed clear the pair: a Reviewer's last unanswered
  // question would otherwise keep a closed Case ageing in their Awaiting
  // Frontline group, with no transition left to clear it.
  for (const fields of [
    machineFor('In-progress').transitionToCompleted(null, undefined, null),
    machineFor('Actions In Progress').transitionToFinalComplete(),
  ]) {
    assert.equal(fields.status, 'Completed');
    assert.equal(fields.awaitingResponsibleParty, false);
    assert.equal(fields.awaitingSince, null);
  }
});

test('CaseMachine final close does not re-snapshot the reportable outcome', () => {
  const fields = machineFor('Actions In Progress').transitionToFinalComplete();

  assert.equal(fields.status, 'Completed');
  assert.equal(typeof fields.completedAt, 'string');
  assert.equal(Object.hasOwn(fields, 'reportableAt'), false);
  assert.equal(Object.hasOwn(fields, 'outcomeAtCompletion'), false);
});
