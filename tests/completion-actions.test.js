// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';
import { CaseMachine } from '../src/lib/case-machine.js';
import {
  completeCase,
  completionControl,
  completionPatch,
  readyToClose,
} from '../src/pages/cora-case-review/completion-actions.js';

isolateBrowserGlobals();
/** @type {any} */ (globalThis).location = { hash: '' };

/** @type {import('../src/sharepoint-client.js').CaseRow} */
const CASE_ROW = {
  id: 'c1',
  caseType: 'example-review',
  title: 'Case',
  status: 'In-progress',
  assignedReviewer: 'u1',
  responsibleParty: 'u2',
  answers: {},
  conversation: [],
  notes: '',
  completedAt: null,
  etag: 'e1',
};

/** @type {import('../src/services/permissions.js').Capabilities} */
const CAPABILITIES = {
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

/** @type {import('../src/sharepoint-client.js').CaseTypeConfig} */
const CONFIG = {
  questions: [],
  computeOutcome: () => ({ outcome: 'pass' }),
  outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
  defaultOutcomeId: 'pass',
};

/**
 * The Case's resolved catalogue: `q1` is in it and fails on "No". Whether a Case
 * carries remediation is a question about the Remediation tab's *rows*, so the
 * fork can only be exercised against a catalogue that has the Question in it
 * (#502).
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

test('completionPatch freezes outcome and ADR-0019 effective columns in the lifecycle PATCH', () => {
  const answers = {
    q1: {
      value: 'No',
      remediationActions: [{ id: 'a1', text: 'Fix' }],
    },
  };
  const patch = completionPatch({
    machine: machine(),
    caseRow: CASE_ROW,
    catalogue: CATALOGUE,
    answers,
    allAnswered: true,
    computeOutcome: () => ({ outcome: 'fail' }),
    exportHash: 'sha256:v1',
  });

  assert.equal(patch?.status, 'Actions In Progress');
  assert.equal(patch?.outcomeAtCompletion, 'fail');
  assert.equal(patch?.hadRemediation, true);
  assert.equal(patch?.effectiveOutcome, 'fail');
  assert.equal(patch?.effectiveHadRemediation, true);
  assert.equal(patch?.outcomeOverridden, false);
  assert.equal(patch?.questionBankVersion, 'sha256:v1');
  assert.equal('onHold' in (patch ?? {}), false);
  assert.equal('placedOnHoldAt' in (patch ?? {}), false);
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
    computeOutcome: () => ({ outcome: 'pass' }),
    exportHash: null,
  };

  const sendActions = completionPatch({
    ...base,
    answers: {
      q1: {
        value: 'No',
        remediationActions: [{ id: 'a1', text: 'Fix' }],
      },
    },
  });
  assert.equal(sendActions?.status, 'Actions In Progress');
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
    computeOutcome: () => ({ outcome: 'pass' }),
    exportHash: null,
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

// --- The question-level Remediation gate (#499) ---

/** @type {Record<string, import('../src/sharepoint-client.js').Answer>} */
const UNRESOLVED = {
  q1: {
    value: 'No',
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
  });
  assert.equal(control.visible, true);
  assert.equal(control.disabled, true);
  assert.equal(control.label, 'Complete Case');
  assert.match(String(control.reason), /remediation/i);

  const ready = completionControl({
    machine: closingMachine(true),
    caseRow: CASE_ROW,
    catalogue: CATALOGUE,
    answers: {
      q1: { ...UNRESOLVED.q1, remediationStatus: { status: 'complete' } },
    },
    allAnswered: true,
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
  });
  assert.equal(control.visible, true);
  assert.equal(control.disabled, false);
  assert.equal(control.label, 'Send Actions');
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
      computeOutcome: () => ({ outcome: 'pass' }),
      exportHash: null,
    }),
    null
  );
});

test('free-form remediation alone sends the Case down the actions path (#502)', () => {
  // One definition of "carries remediation", and it is the Remediation tab's own
  // rows: an applicable, failed Question in the catalogue with ≥1 selected
  // Remediation Action *or* non-empty free-form text (ADR-0037). `q1` is all of
  // those, so the free-form text alone forks the Case to the actions path — the
  // row it forks for is the row the Reviewer will resolve.
  const answers = {
    q1: { value: 'No', freeFormRemediation: 'Call the customer back' },
  };
  const patch = completionPatch({
    machine: machine(),
    caseRow: CASE_ROW,
    catalogue: CATALOGUE,
    answers,
    allAnswered: true,
    computeOutcome: () => ({ outcome: 'fail' }),
    exportHash: null,
  });

  assert.equal(patch?.status, 'Actions In Progress');
  assert.equal(patch?.hadRemediation, true);
  assert.equal(typeof patch?.remediationDueDate, 'string');

  const control = completionControl({
    machine: machine(),
    caseRow: CASE_ROW,
    catalogue: CATALOGUE,
    answers,
    allAnswered: true,
  });
  assert.equal(control.label, 'Send Actions');
});

test('whitespace-only free-form remediation is not remediation (#502)', () => {
  const answers = { q1: { value: 'No', freeFormRemediation: '   ' } };
  const patch = completionPatch({
    machine: machine(),
    caseRow: CASE_ROW,
    catalogue: CATALOGUE,
    answers,
    allAnswered: true,
    computeOutcome: () => ({ outcome: 'fail' }),
    exportHash: null,
  });
  assert.equal(patch?.status, 'Completed');
});

test('remediation on a Question that has left the catalogue does not fork the Case (#502)', () => {
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
    };
    assert.equal(completionControl(base).label, 'Complete Case');

    const patch = completionPatch({
      ...base,
      computeOutcome: () => ({ outcome: 'fail' }),
      exportHash: null,
    });
    assert.equal(patch?.status, 'Completed');
    assert.equal(patch?.hadRemediation, false);
    assert.equal('remediationDueDate' in (patch ?? {}), false);
  }
});
