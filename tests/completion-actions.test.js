// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';
import { CaseMachine } from '../src/lib/case-machine.js';
import {
  completeCase,
  completionPatch,
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

function machine() {
  return new CaseMachine(CASE_ROW, { id: 'u1' }, CAPABILITIES, CONFIG);
}

test('completionPatch freezes outcome and ADR-0019 effective columns in the lifecycle PATCH', () => {
  const answers = {
    q1: {
      value: 'No',
      remediationActions: [{ id: 'a1', text: 'Fix', completed: false }],
    },
  };
  const patch = completionPatch({
    machine: machine(),
    caseRow: CASE_ROW,
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
});

test('completionPatch rejects incomplete or unauthorised completion and uses final-close transition when ready', () => {
  const base = {
    machine: machine(),
    caseRow: CASE_ROW,
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
        canCompleteRemediation: true,
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
