// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActionsInProgressTransition,
  buildCompletedTransition,
  buildFinalCompleteTransition,
  buildVoidTransition,
} from '../src/evaluators/case-transitions.js';
import { CASE_STATUS } from '../src/lib/case-statuses.js';
import { addWorkingDays } from '../src/lib/add-working-days.js';
import {
  ENGLAND_WALES_HOLIDAYS,
  REMEDIATION_SLA_WORKING_DAYS,
} from '../src/config/working-days.js';

// Capability: the PATCH fields each lifecycle transition writes.
//
// Pure functions of what they are handed — there is no machine to construct and
// no Case Type registry to configure, which is what letting Sections declare
// their own access finally bought this file.

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
 * The arguments the two reportable-milestone builders take. A helper rather
 * than a machine, because there is nothing to construct any more: a transition
 * is a function of what it is handed.
 *
 * @param {import('../src/sharepoint-client.js').CaseTypeConfig} [config]
 * @param {import('../src/sharepoint-client.js').QuestionDefinition[]} [catalogue]
 */
function transitionArgs(config = EMPTY_CONFIG, catalogue = CATALOGUE) {
  return { config, catalogue };
}

/**
 * What a reportable-milestone transition stamps from: the three arguments the
 * class method took positionally, named.
 *
 * @param {any} computeOutcome
 * @param {any} [answers]
 * @param {string | null} [questionBankVersion]
 */
function reportableArgs(computeOutcome, answers, questionBankVersion) {
  return { computeOutcome, answers, questionBankVersion };
}

test('Case transitions: stamps questionBankVersion only when supplied', () => {
  assert.equal(
    buildCompletedTransition({
      ...transitionArgs(),
      questionBankVersion: 'sha256:aabbccdd',
    }).questionBankVersion,
    'sha256:aabbccdd'
  );
  assert.equal(
    Object.hasOwn(
      buildCompletedTransition({
        ...transitionArgs(),
        questionBankVersion: null,
      }),
      'questionBankVersion'
    ),
    false
  );
  assert.equal(
    Object.hasOwn(
      buildCompletedTransition(transitionArgs()),
      'questionBankVersion'
    ),
    false
  );
});

test('Case transitions: void stamps the terminal fields and no Outcome', () => {
  const fields = buildVoidTransition({
    currentUserId: 'u1',
    reasonKey: 'duplicate',
    now: () => new Date('2026-03-04T09:00:00Z'),
  });

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

test('Case transitions: void records the words written under a reason that has no meaning alone', () => {
  const voidWith = (/** @type {string} */ note) =>
    buildVoidTransition({ currentUserId: 'u1', reasonKey: 'other', note });

  assert.equal(
    voidWith('  the file was destroyed  ').voidReasonNote,
    'the file was destroyed',
    'stored trimmed'
  );
  assert.equal(voidWith('   ').voidReasonNote, null);
});

test('Case transitions: Send Actions stamps the reportable snapshot without completedAt', () => {
  const answers = {
    'q-needs': {
      value: 'No',
      remediationActions: [{ id: 'ra-0', text: 'Retrain.' }],
    },
  };
  const fields = buildActionsInProgressTransition({
    ...transitionArgs(),
    computeOutcome: () => ({ outcome: 'fail' }),
    answers: answers,
    questionBankVersion: 'sha256:v1',
  });

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

test('Case transitions: Send Actions honours the Case Type remediation SLA in working days', () => {
  const fields = buildActionsInProgressTransition({
    ...transitionArgs({ ...EMPTY_CONFIG, remediationSlaWorkingDays: 5 }),
    ...reportableArgs(
      () => ({ outcome: 'fail' }),
      {
        'q-needs': {
          value: 'No',
          remediationActions: [{ id: 'ra-0', text: 'x' }],
        },
      },
      null
    ),
  });

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

test('Case transitions: no-actions completion stamps reportable and completed together', () => {
  const fields = buildCompletedTransition({
    ...transitionArgs(),
    computeOutcome: () => ({ outcome: 'pass' }),
    answers: { 'q-welcome': { value: 'Yes' } },
    questionBankVersion: null,
  });

  assert.equal(fields.status, 'Completed');
  assert.equal(typeof fields.reportableAt, 'string');
  assert.equal(fields.reportableAt, fields.completedAt);
  assert.equal(fields.outcomeAtCompletion, 'pass');
  assert.equal(fields.hadRemediation, false);
  assert.equal(Object.hasOwn(fields, 'remediationDueDate'), false);
});

test('Case transitions: snapshots hadRemediation from free-form remediation too', () => {
  const fields = buildActionsInProgressTransition({
    ...transitionArgs(),
    computeOutcome: () => ({ outcome: 'fail' }),
    answers: {
      'q-welcome': { value: 'No', freeFormRemediation: 'Call back' },
    },
    questionBankVersion: null,
  });
  assert.equal(fields.hadRemediation, true);
  assert.equal(fields.effectiveHadRemediation, true);
});

test('Case transitions: does not stamp hadRemediation for a Question that has left the catalogue', () => {
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
  const fields = buildActionsInProgressTransition({
    ...transitionArgs(EMPTY_CONFIG, deprecated),
    ...reportableArgs(() => ({ outcome: 'fail' }), orphaned, null),
  });
  assert.equal(fields.hadRemediation, false);
  assert.equal(fields.effectiveHadRemediation, false);

  // The other half — that the Section it would have been resolved on is not
  // offered either — is an access question, and lives with the permissions.
});

test('Case transitions: stamps every lifecycle timestamp from the injected clock', () => {
  const now = () => new Date('2026-07-23T09:30:00.000Z');
  /** @param {'In-progress'|'Actions In Progress'} status */
  const clock = { now };

  const sendActions = buildActionsInProgressTransition({
    ...transitionArgs(EMPTY_CONFIG, []),
    ...clock,
    ...reportableArgs(null, undefined, null),
  });
  assert.equal(sendActions.reportableAt, '2026-07-23T09:30:00.000Z');
  // The SLA start moves with the clock; the working-day arithmetic behind it
  // does not (the holiday list stays frozen).
  assert.equal(sendActions.remediationDueDate, '2026-08-06');
  assert.equal(sendActions.awaitingSince, '2026-07-23T09:30:00.000Z');

  const completed = buildCompletedTransition({
    ...transitionArgs(EMPTY_CONFIG, []),
    ...clock,
    ...reportableArgs(null, undefined, null),
  });
  assert.equal(completed.reportableAt, '2026-07-23T09:30:00.000Z');
  assert.equal(completed.completedAt, '2026-07-23T09:30:00.000Z');

  assert.equal(
    buildFinalCompleteTransition(clock).completedAt,
    '2026-07-23T09:30:00.000Z'
  );
});

test('Case transitions: closing a Case stops it awaiting the frontline', () => {
  // Both routes to Completed clear the pair: a Reviewer's last unanswered
  // question would otherwise keep a closed Case ageing in their Awaiting
  // Frontline group, with no transition left to clear it.
  for (const fields of [
    buildCompletedTransition({
      ...transitionArgs(),
      computeOutcome: null,
      answers: undefined,
      questionBankVersion: null,
    }),
    buildFinalCompleteTransition(),
  ]) {
    assert.equal(fields.status, 'Completed');
    assert.equal(fields.awaitingResponsibleParty, false);
    assert.equal(fields.awaitingSince, null);
  }
});

test('Case transitions: final close does not re-snapshot the reportable outcome', () => {
  const fields = buildFinalCompleteTransition();

  assert.equal(fields.status, 'Completed');
  assert.equal(typeof fields.completedAt, 'string');
  assert.equal(Object.hasOwn(fields, 'reportableAt'), false);
  assert.equal(Object.hasOwn(fields, 'outcomeAtCompletion'), false);
});
