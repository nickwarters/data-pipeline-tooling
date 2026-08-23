// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';
import { installDom, findByClass } from './_dom-stub.js';
import { fireEvent } from './helpers/semantic-dom.js';
import { CaseMachine } from '../src/lib/case-machine.js';
import { CASE_STATUS } from '../src/lib/case-statuses.js';
import {
  completeCase,
  completionControl,
  completionControlView,
  completionPatch,
  readyToClose,
} from '../src/pages/cora-case-review/completion-actions.js';
import { makeCaseRow, makePermissions } from './helpers/fixtures.js';

isolateBrowserGlobals();
installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const CASE_ROW = makeCaseRow({
  id: 'c1',
  caseType: 'example-review',
  title: 'Case',
  assignedReviewer: 'u1',
  responsibleParty: 'u2',
  etag: 'e1',
});

const CAPABILITIES = makePermissions({ isReviewer: false, isVisitor: true });

/** @type {import('../src/sharepoint-client.js').CaseTypeConfig} */
const CONFIG = {
  questions: [],
  computeOutcome: () => ({ outcome: 'pass' }),
  outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
  defaultOutcomeId: 'pass',
};

/**
 * The Case's resolved catalogue: `q1` is in it and fails on "No". Whether a
 * Case carries remediation is a question about the Remediation tab's *rows*, so
 * the fork can only be exercised against a catalogue that has the Question in
 * it.
 *
 * @type {import('../src/sharepoint-client.js').QuestionDefinition[]}
 */
const CATALOGUE = [
  {
    id: 'q1',
    text: 'Greeted?',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
  },
];

/** @param {import('../src/sharepoint-client.js').QuestionDefinition[]} [catalogue] */
function machine(catalogue = CATALOGUE) {
  return new CaseMachine(CASE_ROW, { id: 'u1' }, CAPABILITIES, CONFIG, {
    catalogue,
  });
}

test('completionControlView renders the existing completion control markup and callback', () => {
  let completed = 0;
  const node = completionControlView({
    control: {
      visible: true,
      disabled: false,
      label: 'Complete Case',
      reason: 'Finish the remaining work.',
    },
    pending: false,
    onComplete: () => {
      completed += 1;
    },
  });
  const root = findByClass({ _children: [node] }, 'cora-completion');
  const button = root.querySelector('.cora-complete-btn');
  assert.equal(button.textContent, 'Complete Case');
  assert.equal(button.disabled, false);
  assert.equal(button.title, 'Finish the remaining work.');
  assert.equal(
    root.querySelector('.cora-completion-reason').textContent,
    'Finish the remaining work.'
  );
  const pending = completionControlView({
    control: {
      visible: true,
      disabled: false,
      label: 'Complete Case',
      reason: null,
    },
    pending: true,
    onComplete: () => {},
  });
  assert.equal(
    findByClass({ _children: [pending] }, 'cora-completion').querySelector(
      '.cora-complete-btn'
    ).disabled,
    true
  );
  const disabled = completionControlView({
    control: {
      visible: true,
      disabled: true,
      label: 'Complete Case',
      reason: 'Still blocked.',
    },
    pending: false,
    onComplete: () => {},
  });
  assert.equal(
    findByClass({ _children: [disabled] }, 'cora-completion').querySelector(
      '.cora-complete-btn'
    ).disabled,
    true
  );
  fireEvent(button, 'click');
  assert.equal(completed, 1);
});

test('completionPatch freezes outcome and effective columns in the lifecycle PATCH', () => {
  const answers = {
    q1: {
      value: 'No',
      remediationRequired: /** @type {const} */ ('yes'),
      remediationActions: [{ id: 'a1', text: 'Fix' }],
    },
  };
  const patch = completionPatch({
    machine: machine(),
    caseRow: CASE_ROW,
    catalogue: CATALOGUE,
    answers,
    allAnswered: true,
    captureGroups: [],
    generalQuestions: [],
    computeOutcome: () => ({ outcome: 'fail' }),
    bankVersion: 'sha256:v1',
  });

  assert.equal(patch?.status, CASE_STATUS.ACTIONS_IN_PROGRESS);
  assert.equal(patch?.outcomeAtCompletion, 'fail');
  assert.equal(patch?.hadRemediation, true);
  assert.equal(patch?.effectiveOutcome, 'fail');
  assert.equal(patch?.effectiveHadRemediation, true);
  assert.equal(patch?.outcomeOverridden, false);
  assert.equal(patch?.questionBankVersion, 'sha256:v1');
  assert.equal('onHold' in (patch ?? {}), false);
  assert.equal('placedOnHoldAt' in (patch ?? {}), false);
});

test('completionPatch chooses the transition from the catalogue CaseMachine stamps', () => {
  // The fork and the `hadRemediation` stamp are the same fact read twice, so
  // they must come from one object. Handing the machine an empty catalogue while
  // the caller passes a populated one is not a real state — both are the one
  // CaseLoader catalogue in production — but it is the only way to
  // prove which copy is authoritative, and that the patch cannot say
  // "Actions In Progress" while stamping `hadRemediation: false`.
  const answers = {
    q1: {
      value: 'No',
      remediationRequired: /** @type {const} */ ('yes'),
      remediationActions: [{ id: 'a1', text: 'Fix' }],
    },
  };
  const patch = completionPatch({
    machine: machine([]),
    caseRow: CASE_ROW,
    catalogue: CATALOGUE,
    answers,
    allAnswered: true,
    captureGroups: [],
    generalQuestions: [],
    computeOutcome: () => ({ outcome: 'fail' }),
    bankVersion: null,
  });

  assert.equal(
    patch?.status,
    'Completed',
    'the machine has no Question carrying remediation, so there is no actions path'
  );
  assert.equal(
    patch?.hadRemediation,
    false,
    'and the stamp agrees with the transition that was chosen'
  );
});

test('completionPatch atomically clears hold fields when either transition leaves In-progress', () => {
  const heldCase = {
    ...CASE_ROW,
    onHold: true,
    placedOnHoldAt: '2026-07-23T09:30:00.000Z',
  };
  const base = {
    machine: machine(),
    caseRow: heldCase,
    catalogue: CATALOGUE,
    allAnswered: true,
    captureGroups: [],
    generalQuestions: [],
    computeOutcome: () => ({ outcome: 'pass' }),
    bankVersion: null,
  };

  const sendActions = completionPatch({
    ...base,
    answers: {
      q1: {
        value: 'No',
        remediationRequired: /** @type {const} */ ('yes'),
        remediationActions: [{ id: 'a1', text: 'Fix' }],
      },
    },
  });
  assert.equal(sendActions?.status, CASE_STATUS.ACTIONS_IN_PROGRESS);
  assert.equal(sendActions?.onHold, false);
  assert.equal(sendActions?.placedOnHoldAt, null);

  const complete = completionPatch({ ...base, answers: {} });
  assert.equal(complete?.status, 'Completed');
  assert.equal(complete?.onHold, false);
  assert.equal(complete?.placedOnHoldAt, null);

  const unheldComplete = completionPatch({
    ...base,
    caseRow: CASE_ROW,
    answers: {},
  });
  assert.equal('onHold' in (unheldComplete ?? {}), false);
  assert.equal('placedOnHoldAt' in (unheldComplete ?? {}), false);
});

test('completionPatch rejects incomplete or unauthorised completion and uses final-close transition when ready', () => {
  const base = {
    machine: machine(),
    caseRow: CASE_ROW,
    catalogue: CATALOGUE,
    answers: {},
    allAnswered: false,
    captureGroups: [],
    generalQuestions: [],
    computeOutcome: () => ({ outcome: 'pass' }),
    bankVersion: null,
  };
  assert.equal(completionPatch(base), null);
  assert.equal(completionPatch({ ...base, machine: null }), null);
  assert.deepEqual(
    completionPatch({
      ...base,
      machine: /** @type {any} */ ({
        mayResolveRemediation: true,
        transitionToFinalComplete: () => ({ status: 'Completed' }),
      }),
    }),
    { status: 'Completed' }
  );
});

test('completeCase flushes first and sends the frozen snapshot in the same PATCH', async () => {
  /** @type {any[]} */
  const calls = [];
  const patchFields = machine().transitionToCompleted(
    () => ({ outcome: 'pass' }),
    { q1: { value: 'Yes' } },
    'sha256:v2'
  );
  const saveQueue = /** @type {any} */ ({
    async flushCase(/** @type {string} */ id) {
      calls.push(['flush', id]);
      return true;
    },
    getEtag() {
      return 'e2';
    },
  });
  const client = /** @type {any} */ ({
    async patchCase(
      /** @type {string} */ id,
      /** @type {Partial<import('../src/sharepoint-client.js').CaseRow>} */ fields,
      /** @type {string} */ etag,
      /** @type {import('../src/sharepoint-client.js').CaseListOptions} */ opts
    ) {
      calls.push(['patch', id, fields, etag, opts]);
      return { ok: true, status: 200 };
    },
  });

  const ok = await completeCase({
    caseId: 'c1',
    client,
    saveQueue,
    patchFields,
    caseListOptions: { listName: 'Complaints' },
  });

  assert.equal(ok, true);
  assert.deepEqual(calls, [
    ['flush', 'c1'],
    ['patch', 'c1', patchFields, 'e2', { listName: 'Complaints' }],
  ]);
  assert.equal(location.hash, '#/dashboard');
});

test('completeCase navigates through an injected callback, leaving location alone', async () => {
  /** @type {string[]} */
  const navigations = [];
  const saveQueue = /** @type {any} */ ({
    async flushCase() {
      return true;
    },
    getEtag() {
      return 'e2';
    },
  });
  const client = /** @type {any} */ ({
    async patchCase() {
      return { ok: true, status: 200 };
    },
  });
  location.hash = 'untouched';

  assert.equal(
    await completeCase({
      caseId: 'c1',
      client,
      saveQueue,
      patchFields: { status: 'Completed' },
      navigate: (hash) => navigations.push(hash),
    }),
    true
  );

  assert.deepEqual(navigations, ['#/dashboard']);
  assert.equal(
    location.hash,
    'untouched',
    'an injected navigation replaces the seam rather than adding to it'
  );
});

test('completeCase does not PATCH after a failed flush or navigate after a failed PATCH', async () => {
  let patches = 0;
  const client = /** @type {any} */ ({
    async patchCase() {
      patches++;
      return { ok: false, status: 500 };
    },
  });
  const failedFlush = /** @type {any} */ ({
    async flushCase() {
      return false;
    },
    getEtag() {
      return 'e1';
    },
  });
  location.hash = 'keep-me';
  assert.equal(
    await completeCase({
      caseId: 'c1',
      client,
      saveQueue: failedFlush,
      patchFields: { status: 'Completed' },
    }),
    false
  );
  assert.equal(patches, 0);

  const successfulFlush = /** @type {any} */ ({
    async flushCase() {
      return true;
    },
    getEtag() {
      return 'e1';
    },
  });
  assert.equal(
    await completeCase({
      caseId: 'c1',
      client,
      saveQueue: successfulFlush,
      patchFields: { status: 'Completed' },
    }),
    false
  );
  assert.equal(location.hash, 'keep-me');
});

test('completeCase returns false when dependencies or patch fields are absent', async () => {
  assert.equal(
    await completeCase({
      caseId: 'c1',
      client: null,
      saveQueue: null,
      patchFields: null,
    }),
    false
  );
});

// --- The question-level Remediation gate ---

/** @type {Record<string, import('../src/sharepoint-client.js').Answer>} */
const UNRESOLVED = {
  q1: {
    value: 'No',
    remediationRequired: 'yes',
    remediationActions: [{ id: 'a1', text: 'Call back' }],
  },
};

/** @param {boolean} permitted */
function closingMachine(permitted) {
  return /** @type {any} */ ({
    mayResolveRemediation: permitted,
    canComplete: false,
    transitionToFinalComplete: () => ({ status: 'Completed' }),
  });
}

test('readyToClose: the Reviewer may close only once every remediation row is resolved', () => {
  assert.equal(
    readyToClose({
      machine: closingMachine(true),
      catalogue: CATALOGUE,
      answers: UNRESOLVED,
    }),
    false
  );

  assert.equal(
    readyToClose({
      machine: closingMachine(true),
      catalogue: CATALOGUE,
      answers: {
        q1: { ...UNRESOLVED.q1, remediationStatus: { status: 'complete' } },
      },
    }),
    true
  );
});

test('readyToClose: a partial resolution still needs its details', () => {
  const withStatus = (/** @type {any} */ remediationStatus) => ({
    machine: closingMachine(true),
    catalogue: CATALOGUE,
    answers: { q1: { ...UNRESOLVED.q1, remediationStatus } },
  });
  assert.equal(readyToClose(withStatus({ status: 'partial' })), false);
  assert.equal(
    readyToClose(withStatus({ status: 'partial', details: 'Half done' })),
    true
  );
});

test('readyToClose: false without the CaseMachine permission, however resolved', () => {
  assert.equal(
    readyToClose({
      machine: closingMachine(false),
      catalogue: CATALOGUE,
      answers: {
        q1: { ...UNRESOLVED.q1, remediationStatus: { status: 'complete' } },
      },
    }),
    false
  );
});

test('completionControl: shows Complete Case disabled, with the reason, while remediation is unresolved', () => {
  // Hiding it made the gate invisible everywhere except the Remediation tab, so
  // from the Summary the feature simply looked absent. Disabled-with-a-reason
  // says what has to happen instead.
  const control = completionControl({
    machine: closingMachine(true),
    caseRow: CASE_ROW,
    catalogue: CATALOGUE,
    answers: UNRESOLVED,
    allAnswered: true,
    captureGroups: [],
    generalQuestions: [],
  });
  assert.equal(control.visible, true);
  assert.equal(control.disabled, true);
  assert.equal(control.label, 'Complete Case');
  assert.match(String(control.reason), /remediation/i);

  // The close path never asks for a Responsible Party: by then the actions are
  // already sent, so an empty one holds nothing.
  const ready = completionControl({
    machine: closingMachine(true),
    caseRow: { ...CASE_ROW, responsibleParty: '' },
    catalogue: CATALOGUE,
    answers: {
      q1: { ...UNRESOLVED.q1, remediationStatus: { status: 'complete' } },
    },
    allAnswered: true,
    captureGroups: [],
    generalQuestions: [],
  });
  assert.equal(ready.visible, true);
  assert.equal(ready.disabled, false);
  assert.equal(ready.reason, null);
  assert.equal(ready.label, 'Complete Case');
});

test('completionControl: a viewer who cannot resolve remediation sees no button at all', () => {
  // The disabled button is the Assigned Reviewer's gate, not a notice board: a
  // viewer without the permission half still sees nothing.
  const control = completionControl({
    machine: closingMachine(false),
    caseRow: CASE_ROW,
    catalogue: CATALOGUE,
    answers: UNRESOLVED,
    allAnswered: true,
    captureGroups: [],
    generalQuestions: [],
  });
  assert.equal(control.visible, false);
});

test('completionControl: the pre-send path still reads Send Actions and is enabled', () => {
  const control = completionControl({
    machine: /** @type {any} */ ({
      mayResolveRemediation: false,
      canComplete: true,
    }),
    caseRow: CASE_ROW,
    catalogue: CATALOGUE,
    answers: UNRESOLVED,
    allAnswered: true,
    captureGroups: [],
    generalQuestions: [],
  });
  assert.equal(control.visible, true);
  assert.equal(control.disabled, false);
  assert.equal(control.label, 'Send Actions');
});

test('completionControl: no Responsible Party names the gate instead of hiding it', () => {
  // The Case-level Responsible Party is who the actions are sent to, so the
  // control is offered but disabled — and writes nothing — until the Reviewer
  // has named one.
  const answers = {
    q1: {
      value: 'No',
      remediationRequired: /** @type {const} */ ('yes'),
      remediationActions: [{ id: 'a1', text: 'Fix' }],
    },
  };
  const base = {
    machine: machine(),
    catalogue: CATALOGUE,
    answers,
    allAnswered: true,
    captureGroups: [],
    generalQuestions: [],
  };
  const patchInput = {
    computeOutcome: () => ({ outcome: /** @type {string} */ ('fail') }),
    bankVersion: null,
  };
  const unset = { ...CASE_ROW, responsibleParty: '' };

  const unnamed = completionControl({ ...base, caseRow: unset });
  assert.equal(unnamed.visible, true, 'the gate is legible, not absent');
  assert.equal(unnamed.disabled, true, 'but nothing can be sent yet');
  assert.equal(unnamed.label, 'Send Actions');
  assert.match(
    String(unnamed.reason),
    /Responsible Party/,
    'and the reason says who is missing'
  );
  assert.equal(
    completionPatch({ ...base, caseRow: unset, ...patchInput }),
    null,
    'and a raw call writes nothing either'
  );

  const named = completionControl({ ...base, caseRow: CASE_ROW });
  assert.equal(named.visible, true);
  assert.equal(named.disabled, false);
  assert.equal(named.label, 'Send Actions');
  assert.equal(
    completionPatch({ ...base, caseRow: CASE_ROW, ...patchInput })?.status,
    CASE_STATUS.ACTIONS_IN_PROGRESS
  );
});

test('readyToClose: an absent catalogue is no rows, not a thrown render', () => {
  // The gate is recomputed on every render, so it must tolerate a caller that
  // has no catalogue rather than throwing out of the view. No catalogue means
  // no Questions, hence no remediation to resolve — the permission half is
  // still required, exactly as on a Case that carries no remediation.
  assert.equal(
    readyToClose({
      machine: closingMachine(true),
      catalogue: /** @type {any} */ (undefined),
      answers: UNRESOLVED,
    }),
    true
  );
  assert.equal(
    readyToClose({
      machine: closingMachine(false),
      catalogue: /** @type {any} */ (undefined),
      answers: UNRESOLVED,
    }),
    false
  );
});

test('completionPatch: refuses the final close while a remediation row is unresolved', () => {
  assert.equal(
    completionPatch({
      machine: closingMachine(true),
      caseRow: CASE_ROW,
      catalogue: CATALOGUE,
      answers: UNRESOLVED,
      allAnswered: true,
      captureGroups: [],
      generalQuestions: [],
      computeOutcome: () => ({ outcome: 'pass' }),
      bankVersion: null,
    }),
    null
  );
});

test('free-form remediation alone sends the Case down the actions path', () => {
  // One definition of "carries remediation", and it is the Remediation tab's own
  // rows: an applicable, failed Question in the catalogue with ≥1 selected
  // Remediation Action *or* non-empty free-form text. `q1` is all of
  // those, so the free-form text alone forks the Case to the actions path — the
  // row it forks for is the row the Reviewer will resolve.
  const answers = {
    q1: {
      value: 'No',
      remediationRequired: /** @type {const} */ ('yes'),
      freeFormRemediation: 'Call the customer back',
    },
  };
  const patch = completionPatch({
    machine: machine(),
    caseRow: CASE_ROW,
    catalogue: CATALOGUE,
    answers,
    allAnswered: true,
    captureGroups: [],
    generalQuestions: [],
    computeOutcome: () => ({ outcome: 'fail' }),
    bankVersion: null,
  });

  assert.equal(patch?.status, CASE_STATUS.ACTIONS_IN_PROGRESS);
  assert.equal(patch?.hadRemediation, true);
  assert.equal(typeof patch?.remediationDueDate, 'string');

  const control = completionControl({
    machine: machine(),
    caseRow: CASE_ROW,
    catalogue: CATALOGUE,
    answers,
    allAnswered: true,
    captureGroups: [],
    generalQuestions: [],
  });
  assert.equal(control.label, 'Send Actions');
});

test('whitespace-only free-form remediation is not remediation', () => {
  const answers = {
    q1: {
      value: 'No',
      remediationRequired: /** @type {const} */ ('yes'),
      freeFormRemediation: '   ',
    },
  };
  const control = completionControl({
    machine: machine(),
    caseRow: CASE_ROW,
    catalogue: CATALOGUE,
    answers,
    allAnswered: true,
    captureGroups: [],
    generalQuestions: [],
  });
  assert.equal(
    control.label,
    'Complete Case',
    'whitespace is no row on the Remediation tab, so there is nothing to send'
  );
  assert.equal(
    control.disabled,
    true,
    'and it does not satisfy the decision either'
  );

  assert.equal(
    completionPatch({
      machine: machine(),
      caseRow: CASE_ROW,
      catalogue: CATALOGUE,
      answers,
      allAnswered: true,
      captureGroups: [],
      generalQuestions: [],
      computeOutcome: () => ({ outcome: 'fail' }),
      bankVersion: null,
    }),
    null
  );
});

test('remediation on a Question that has left the catalogue does not fork the Case', () => {
  // The Reviewer failed `q1` and typed remediation; a Maintainer has since
  // marked `q1` deprecated — the operation CLAUDE.md mandates instead of
  // deletion — so it is filtered out of the loaded catalogue. The Answer keeps
  // the text, but the Remediation tab has no row for it.
  //
  // Before this fix the fork read the Answers blob alone, a strict superset of
  // the tab's rows: the button said "Send Actions", the Case took the actions
  // path with a 10-working-day SLA, and the Remediation tab rendered "No
  // remediation actions sent." beside that date. `remediationComplete` was
  // vacuously true over the empty row set, so the Reviewer closed the Case —
  // and the Responsible Party's "Outstanding remediation" table listed work
  // that no row had ever existed to resolve.
  const answers = {
    q1: { value: 'No', freeFormRemediation: 'Refund the customer £40' },
  };
  const deprecated = CATALOGUE.map((q) => ({ ...q, deprecated: true }));

  for (const catalogue of [deprecated, /** @type {typeof CATALOGUE} */ ([])]) {
    const base = {
      machine: machine(catalogue),
      caseRow: CASE_ROW,
      catalogue,
      answers,
      allAnswered: true,
      captureGroups: [],
      generalQuestions: [],
    };
    assert.equal(completionControl(base).label, 'Complete Case');

    const patch = completionPatch({
      ...base,
      computeOutcome: () => ({ outcome: 'fail' }),
      bankVersion: null,
    });
    assert.equal(patch?.status, 'Completed');
    assert.equal(patch?.hadRemediation, false);
    assert.equal('remediationDueDate' in (patch ?? {}), false);
  }
});

// --- The pre-send Remediation Required gate ---

/** @param {Record<string, import('../src/sharepoint-client.js').Answer>} answers */
function preSend(answers) {
  return {
    machine: machine(),
    caseRow: CASE_ROW,
    catalogue: CATALOGUE,
    answers,
    allAnswered: true,
    captureGroups: [],
    generalQuestions: [],
  };
}

test('completionControl: an undecided failed Question disables the button with its reason', () => {
  const control = completionControl(preSend({ q1: { value: 'No' } }));
  assert.equal(control.visible, true);
  assert.equal(control.disabled, true);
  assert.match(String(control.reason), /Is remediation required\?/);
});

test('completionControl: Yes with nothing recorded still blocks', () => {
  const control = completionControl(
    preSend({ q1: { value: 'No', remediationRequired: 'yes' } })
  );
  assert.equal(control.disabled, true);
  assert.match(String(control.reason), /Is remediation required\?/);
});

test('completionControl: every failure decided No completes the Case directly', () => {
  const control = completionControl(
    preSend({ q1: { value: 'No', remediationRequired: 'no' } })
  );
  assert.equal(control.visible, true);
  assert.equal(control.disabled, false);
  assert.equal(control.reason, null);
  assert.equal(control.label, 'Complete Case');
});

test('completionControl: the remediation decision is asked for before the Responsible Party', () => {
  // Both are outstanding, and the Reviewer works down the Issues tab in that
  // order, so only one reason is shown at a time — the nearer one first.
  const undecided = completionControl({
    ...preSend({ q1: { value: 'No' } }),
    caseRow: { ...CASE_ROW, responsibleParty: '' },
  });
  assert.equal(undecided.visible, true);
  assert.equal(undecided.disabled, true);
  assert.match(String(undecided.reason), /Is remediation required\?/);
  assert.doesNotMatch(String(undecided.reason), /Responsible Party/);

  const decided = completionControl({
    ...preSend({
      q1: {
        value: 'No',
        remediationRequired: 'yes',
        remediationActions: [{ id: 'a1', text: 'Fix' }],
      },
    }),
    caseRow: { ...CASE_ROW, responsibleParty: '' },
  });
  assert.equal(decided.visible, true);
  assert.equal(decided.disabled, true);
  assert.match(String(decided.reason), /Responsible Party/);
});

test('completionControl: the direct-complete path does not ask for a Responsible Party', () => {
  // Every failure was decided No, so nothing is being sent to anyone and the
  // field that would name them is not even rendered.
  const control = completionControl({
    ...preSend({ q1: { value: 'No', remediationRequired: 'no' } }),
    caseRow: { ...CASE_ROW, responsibleParty: '' },
  });
  assert.equal(control.visible, true);
  assert.equal(control.disabled, false);
  assert.equal(control.label, 'Complete Case');
  assert.equal(control.reason, null);
});

test('completionControl: a Case with no failures at all needs no Responsible Party', () => {
  // Nothing failed, so there is nothing to remediate, nothing to send, and
  // nobody to name.
  const control = completionControl({
    ...preSend({ q1: { value: 'Yes' } }),
    caseRow: { ...CASE_ROW, responsibleParty: '' },
  });
  assert.equal(control.visible, true);
  assert.equal(control.disabled, false);
  assert.equal(control.label, 'Complete Case');
  assert.equal(control.reason, null);
});

test('completionControl: one failure needing remediation still asks, whatever the others say', () => {
  /** @type {any[]} */
  const mixedCatalogue = [
    ...CATALOGUE,
    {
      id: 'q2',
      text: 'Explained?',
      responseType: 'yes-no-na',
      failureValues: ['No'],
      deprecated: false,
    },
  ];
  const mixed = {
    machine: machine(mixedCatalogue),
    caseRow: { ...CASE_ROW, responsibleParty: '' },
    catalogue: mixedCatalogue,
    answers: {
      q1: { value: 'No', remediationRequired: /** @type {const} */ ('no') },
      q2: {
        value: 'No',
        remediationRequired: /** @type {const} */ ('yes'),
        remediationActions: [{ id: 'a1', text: 'Fix' }],
      },
    },
    allAnswered: true,
    captureGroups: [],
    generalQuestions: [],
  };
  const control = completionControl(mixed);
  assert.equal(control.visible, true);
  assert.equal(control.disabled, true);
  assert.match(String(control.reason), /Responsible Party/);
  assert.equal(
    completionPatch({
      ...mixed,
      computeOutcome: () => ({ outcome: 'fail' }),
      bankVersion: null,
    }),
    null,
    'and nothing is written while it is outstanding'
  );
});

test('completionPatch: a Case needing no remediation completes with no Responsible Party', () => {
  const patch = completionPatch({
    ...preSend({ q1: { value: 'No', remediationRequired: 'no' } }),
    caseRow: { ...CASE_ROW, responsibleParty: '' },
    computeOutcome: () => ({ outcome: 'fail' }),
    bankVersion: null,
  });
  assert.equal(patch?.status, 'Completed');
  assert.equal(patch?.hadRemediation, false);
});

test('completionControl: unanswered Questions still show nothing at all', () => {
  // The Responsible Party moved onto the disabled path; being part-way through
  // the Questions did not. There is no gate to explain yet.
  const control = completionControl({
    ...preSend({ q1: { value: 'No', remediationRequired: 'no' } }),
    caseRow: { ...CASE_ROW, responsibleParty: '' },
    allAnswered: false,
    captureGroups: [],
    generalQuestions: [],
  });
  assert.equal(control.visible, false);
});

test('completionPatch: writes nothing while a failed Question is undecided', () => {
  assert.equal(
    completionPatch({
      ...preSend({ q1: { value: 'No' } }),
      computeOutcome: () => ({ outcome: 'fail' }),
      bankVersion: null,
    }),
    null
  );

  const decided = completionPatch({
    ...preSend({ q1: { value: 'No', remediationRequired: 'no' } }),
    computeOutcome: () => ({ outcome: 'fail' }),
    bankVersion: null,
  });
  assert.equal(decided?.status, 'Completed');
  assert.equal(decided?.hadRemediation, false);
});

test('the close path is untouched by the pre-send decision gate', () => {
  // Once the actions are sent, the decision is history: the close turns on the
  // Remediation tab's resolutions alone.
  const sent = {
    q1: {
      value: /** @type {string} */ ('No'),
      remediationActions: [{ id: 'a1', text: 'Call back' }],
      remediationStatus: /** @type {any} */ ({ status: 'complete' }),
    },
  };
  const control = completionControl({
    machine: closingMachine(true),
    caseRow: CASE_ROW,
    catalogue: CATALOGUE,
    answers: sent,
    allAnswered: true,
    captureGroups: [],
    generalQuestions: [],
  });
  assert.equal(control.disabled, false);
  assert.equal(control.reason, null);
  assert.deepEqual(
    completionPatch({
      machine: closingMachine(true),
      caseRow: CASE_ROW,
      catalogue: CATALOGUE,
      answers: sent,
      allAnswered: true,
      captureGroups: [],
      generalQuestions: [],
      computeOutcome: () => ({ outcome: 'pass' }),
      bankVersion: null,
    }),
    { status: 'Completed' }
  );
});

// --- The pre-send required-capture gate ---

/** @type {import('../src/sharepoint-client.js').CaptureGroup[]} */
const CAPTURE_GROUPS = [
  {
    key: 'cause',
    label: 'Cause',
    fields: [
      { key: 'origin', label: 'Origin', type: 'select', options: ['Sales'] },
      {
        key: 'salesTeam',
        label: 'Sales team',
        type: 'text',
        required: true,
        showWhen: { origin: { equals: 'Sales' } },
      },
    ],
  },
];

/** @param {Record<string, any>} capture @param {string} [value] */
function withCapture(capture, value = 'No') {
  return {
    ...preSend({
      q1: {
        value,
        remediationRequired: /** @type {const} */ ('no'),
        capture,
      },
    }),
    captureGroups: CAPTURE_GROUPS,
    generalQuestions: [],
  };
}

test('completionControl: an empty required capture field disables the button with its reason', () => {
  const control = completionControl(withCapture({ origin: 'Sales' }));
  assert.equal(control.visible, true);
  assert.equal(control.disabled, true);
  assert.match(String(control.reason), /required field/);
  assert.match(String(control.reason), /Issues tab/);

  const filled = completionControl(
    withCapture({ origin: 'Sales', salesTeam: 'North' })
  );
  assert.equal(filled.disabled, false);
  assert.equal(filled.reason, null);
});

test('completionControl: a required field its showWhen hides never blocks', () => {
  const control = completionControl(withCapture({}));
  assert.equal(control.disabled, false);
  assert.equal(control.reason, null);
});

test('completionControl: a required field on a passing Answer never blocks', () => {
  const control = completionControl(withCapture({ origin: 'Sales' }, 'Yes'));
  assert.equal(control.disabled, false);
  assert.equal(control.reason, null);
});

test('completionControl: the remediation decision is still asked for first', () => {
  const control = completionControl({
    ...preSend({ q1: { value: 'No', capture: { origin: 'Sales' } } }),
    captureGroups: CAPTURE_GROUPS,
    generalQuestions: [],
  });
  assert.match(String(control.reason), /Is remediation required\?/);
});

test('completionPatch: writes nothing while a required capture field is empty', () => {
  const patchInput = {
    computeOutcome: () => ({ outcome: /** @type {const} */ ('fail') }),
    bankVersion: null,
  };
  assert.equal(
    completionPatch({ ...withCapture({ origin: 'Sales' }), ...patchInput }),
    null,
    'the button is only a style: the write guard has to hold the same line'
  );
  assert.equal(
    completionPatch({
      ...withCapture({ origin: 'Sales', salesTeam: 'North' }),
      ...patchInput,
    })?.status,
    'Completed'
  );
});

// --- The pre-send required General Questions gate ---

/** @type {import('../src/sharepoint-client.js').GeneralQuestionField[]} */
const GENERAL_QUESTIONS = [
  {
    key: 'reviewChannel',
    label: 'How was this Case reviewed?',
    type: 'select',
    options: ['Case file only', 'Call recording'],
    required: true,
  },
  {
    key: 'reviewerObservations',
    label: 'Observations for the Case Type Owner',
    type: 'textarea',
  },
];

/** A Case with nothing to remediate, so only the General Questions can hold it. */
const CLEAN_ANSWER = { q1: { value: 'Yes' } };

/** @param {Record<string, any>} general */
function withGeneral(general) {
  /** @type {Record<string, any>} */
  const answers = { ...CLEAN_ANSWER };
  for (const [key, value] of Object.entries(general)) {
    answers[`general:${key}`] = { value };
  }
  return { ...preSend(answers), generalQuestions: GENERAL_QUESTIONS };
}

test('completionControl: an unanswered required General Question disables the button with its reason', () => {
  const control = completionControl(withGeneral({}));
  assert.equal(control.visible, true);
  assert.equal(control.disabled, true);
  assert.match(String(control.reason), /General Question/);
  assert.match(String(control.reason), /Review tab/);

  const answered = completionControl(
    withGeneral({ reviewChannel: 'Call recording' })
  );
  assert.equal(answered.disabled, false);
  assert.equal(answered.reason, null);
});

test('completionControl: an unanswered General Question the Case Type left optional never blocks', () => {
  const control = completionControl(
    withGeneral({ reviewChannel: 'Case file only' })
  );
  assert.equal(control.disabled, false);
  assert.equal(control.reason, null);
});

test('completionControl: a required General Question holds Send Actions too, not only the no-actions close', () => {
  const sending = {
    ...preSend({
      q1: {
        value: 'No',
        remediationRequired: /** @type {const} */ ('yes'),
        remediationActions: [{ id: 'a1', text: 'Fix' }],
      },
    }),
    generalQuestions: GENERAL_QUESTIONS,
  };
  const control = completionControl(sending);
  assert.equal(control.label, 'Send Actions');
  assert.equal(control.disabled, true);
  assert.match(String(control.reason), /General Question/);
});

test('completionControl: a General Question is asked for before the Issues tab gates', () => {
  // Both tabs owe something. The Reviewer is sent back through them in the
  // order they appear, rather than to the later one first.
  const control = completionControl({
    ...withGeneral({}),
    answers: { q1: { value: 'No' } },
  });
  assert.match(String(control.reason), /General Question/);
});

test('completionControl: a Case Type declaring no General Questions is gated exactly as before', () => {
  const control = completionControl({
    ...preSend(CLEAN_ANSWER),
    generalQuestions: [],
  });
  assert.equal(control.disabled, false);
  assert.equal(control.reason, null);
});

test('completionPatch: writes nothing while a required General Question is unanswered', () => {
  const patchInput = {
    computeOutcome: () => ({ outcome: /** @type {const} */ ('pass') }),
    bankVersion: null,
  };
  assert.equal(
    completionPatch({ ...withGeneral({}), ...patchInput }),
    null,
    'the button is only a style: the write guard has to hold the same line'
  );
  assert.equal(
    completionPatch({
      ...withGeneral({ reviewChannel: 'Call recording' }),
      ...patchInput,
    })?.status,
    'Completed'
  );
});
