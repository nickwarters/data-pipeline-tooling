// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';
import {
  BASE_ROW,
  CaseMachine,
  CaseReviewHarness,
  EMPTY_CASE_TYPE_CONFIG,
  NO_CAPABILITIES,
  SaveQueue,
  completeBtnOf,
  completeCase,
  fireEvent,
  flush,
  makeClient,
  makeRecordingClient,
} from './helpers/cora-case-review.js';

isolateBrowserGlobals();

// Capability: completion orchestration and frozen outcome snapshots.

test('completeCase: returns early if client or saveQueue missing', async () => {
  /** @type {any} */ (globalThis).location.hash = '';
  await completeCase({
    caseId: 'c1',
    client: null,
    saveQueue: null,
    patchFields: null,
    opts: {},
  });
  assert.equal(/** @type {any} */ (globalThis).location.hash, '');
});

test('completeCase: navigates to the dashboard on a successful PATCH', async () => {
  const client = makeClient();
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  saveQueue.loadCase(BASE_ROW);

  /** @type {any} */ (globalThis).location.hash = '';
  await completeCase({
    caseId: 'c1',
    client: /** @type {any} */ (client),
    saveQueue,
    patchFields: { status: 'Completed' },
    opts: {},
  });
  assert.equal(/** @type {any} */ (globalThis).location.hash, '#/dashboard');
});

test('completeCase: does not navigate on failure', async () => {
  const client = makeClient({ patchOk: false });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  saveQueue.loadCase(BASE_ROW);

  /** @type {any} */ (globalThis).location.hash = 'keep-me';
  await completeCase({
    caseId: 'c1',
    client: /** @type {any} */ (client),
    saveQueue,
    patchFields: { status: 'Completed' },
    opts: {},
  });
  assert.equal(/** @type {any} */ (globalThis).location.hash, 'keep-me');
});

test('completeCase: stamps the frozen outcome snapshot in the same PATCH as status/completedAt', async () => {
  const client = makeRecordingClient();
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  saveQueue.loadCase(BASE_ROW);

  // A failing Answer carrying a Remediation Action.
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

  const machine = new CaseMachine(
    BASE_ROW,
    { id: 'test' },
    NO_CAPABILITIES,
    EMPTY_CASE_TYPE_CONFIG
  );
  const patchFields = machine.transitionToCompleted(computeOutcome, answers);
  await completeCase({
    caseId: 'c1',
    client: /** @type {any} */ (client),
    saveQueue,
    patchFields,
    opts: {},
  });

  assert.equal(
    client.patches.length,
    1,
    'completion is a single PATCH (ADR-0008 ETag-guarded write)'
  );
  const { fields } = client.patches[0];
  assert.equal(fields.status, 'Completed');
  assert.ok(fields.completedAt, 'completedAt is stamped');
  assert.equal(
    fields.outcomeAtCompletion,
    'fail',
    'the frozen outcome is computed over the current answers'
  );
  assert.equal(
    fields.hadRemediation,
    true,
    'hadRemediation is true when an Answer carries a Remediation Action'
  );
});

test('completeCase: initialises the effective-outcome columns equal to the frozen snapshot (ADR-0019)', async () => {
  const client = makeRecordingClient();
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  saveQueue.loadCase(BASE_ROW);

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

  const machine = new CaseMachine(
    BASE_ROW,
    { id: 'test' },
    NO_CAPABILITIES,
    EMPTY_CASE_TYPE_CONFIG
  );
  const patchFields = machine.transitionToCompleted(computeOutcome, answers);
  await completeCase({
    caseId: 'c1',
    client: /** @type {any} */ (client),
    saveQueue,
    patchFields,
    opts: {},
  });

  const { fields } = client.patches[0];
  assert.equal(
    fields.effectiveOutcome,
    'fail',
    'effectiveOutcome initialises equal to outcomeAtCompletion'
  );
  assert.equal(
    fields.effectiveHadRemediation,
    true,
    'effectiveHadRemediation initialises equal to hadRemediation'
  );
  assert.equal(
    fields.outcomeOverridden,
    false,
    'no Override exists at completion'
  );
});

test('completeCase: hadRemediation=true is mutually exclusive with outcomeAtCompletion=pass', async () => {
  const client = makeRecordingClient();
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  saveQueue.loadCase(BASE_ROW);

  // A passing Answer set: no failures, so no Remediation Actions attach.
  const answers = { 'q-welcome': { value: 'Yes' } };
  /** @param {Record<string, any>} a */
  const computeOutcome = (a) =>
    /** @type {any} */ ({
      outcome: Object.values(a).some((x) => x.value === 'No') ? 'fail' : 'pass',
    });

  const machine = new CaseMachine(
    BASE_ROW,
    { id: 'test' },
    NO_CAPABILITIES,
    EMPTY_CASE_TYPE_CONFIG
  );
  const patchFields = machine.transitionToCompleted(computeOutcome, answers);
  await completeCase({
    caseId: 'c1',
    client: /** @type {any} */ (client),
    saveQueue,
    patchFields,
    opts: {},
  });

  const { fields } = client.patches[0];
  assert.equal(fields.outcomeAtCompletion, 'pass');
  assert.equal(
    fields.hadRemediation,
    false,
    'a pass never co-occurs with hadRemediation=true'
  );
});

test('CORACaseReview: complete button feeds the live answers + computeOutcome into the completion PATCH', async () => {
  const client = makeClient();
  /** @type {any[]} */
  const patches = [];
  client.patchCase = /** @type {any} */ (
    async (/** @type {string} */ _id, /** @type {any} */ fields) => {
      patches.push(fields);
      return { ok: true, status: 200 };
    }
  );
  const completableRow = {
    ...BASE_ROW,
    answers: {
      'q-welcome': { value: 'Yes' },
      'q-needs': { value: 'No' },
      'q-channel': { value: 'Email' },
      'q-products': { value: ['Billing'] },
    },
  };
  client.getCase = async () => completableRow;
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  saveQueue.loadCase(completableRow);

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  await el.connectedCallback();

  fireEvent(completeBtnOf(el), 'click');
  await flush();

  assert.equal(
    patches.length,
    1,
    'the button drives a single completion PATCH'
  );
  const captured = patches[0];
  assert.equal(captured.status, 'Completed', 'sets status Completed');
  assert.equal(
    captured.outcomeAtCompletion,
    'fail',
    'computed outcome is written as a patch field'
  );
  assert.equal(
    captured.hadRemediation,
    false,
    'hadRemediation is computed and written'
  );
});

test('completeCase: flushes pending answers before stamping Completed', async () => {
  const answers = {
    'q-welcome': { value: 'Yes' },
    'q-needs': { value: 'No' },
    'q-channel': { value: 'Email' },
    'q-products': { value: ['Billing'] },
  };
  let liveRow = { ...BASE_ROW, answers: {}, etag: 'etag-start' };
  /** @type {Array<{ fields: any, etag: string }>} */
  const patches = [];
  const client = {
    async getCase() {
      return liveRow;
    },
    async getCurrentUser() {
      return { id: 'u1', displayName: 'User 1' };
    },
    async patchCase(
      /** @type {string} */ _id,
      /** @type {any} */ fields,
      /** @type {string} */ etag
    ) {
      patches.push({ fields, etag });
      liveRow = { ...liveRow, ...fields, etag: `etag-${patches.length}` };
      return { ok: true, status: 200, data: liveRow };
    },
    async searchPeople() {
      return [];
    },
    async resolveUsers() {
      return {};
    },
    async getExportHash() {
      return null;
    },
  };
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 5000,
  });
  saveQueue.loadCase(liveRow);
  saveQueue.enqueue('c1', 'answers', answers);

  const machine = new CaseMachine(
    BASE_ROW,
    { id: 'u1' },
    NO_CAPABILITIES,
    EMPTY_CASE_TYPE_CONFIG
  );
  const patchFields = machine.transitionToCompleted(
    EMPTY_CASE_TYPE_CONFIG.computeOutcome,
    answers
  );

  await completeCase({
    caseId: 'c1',
    client: /** @type {any} */ (client),
    saveQueue,
    patchFields,
    opts: {},
  });

  assert.equal(patches.length, 2);
  assert.deepEqual(
    patches[0].fields,
    { answers },
    'pending answers are persisted before completion'
  );
  assert.equal(
    patches[1].etag,
    'etag-1',
    'completion uses the ETag returned by the answer flush'
  );
  assert.equal(patches[1].fields.status, 'Completed');
  assert.deepEqual(liveRow.answers, answers);
  assert.equal(liveRow.status, 'Completed');
});

test('CORACaseReview: complete button stays hidden for a Completed case even when all answered', async () => {
  const completedRow = {
    ...BASE_ROW,
    status: /** @type {'Completed'} */ ('Completed'),
    assignedReviewer: 'u1',
    answers: {
      'q-welcome': { value: 'Yes' },
      'q-needs': { value: 'No' },
      'q-channel': { value: 'Email' },
      'q-products': { value: ['Billing'] },
    },
  };
  const client = makeClient({ caseRow: completedRow });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  saveQueue.loadCase(completedRow);

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  el.capabilities = {
    isReviewer: true,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  await el.connectedCallback();

  const completeBtn = completeBtnOf(el);
  assert.equal(
    completeBtn.hidden,
    true,
    'Complete button must be hidden for a Completed case'
  );
});

test('CORACaseReview: complete button click is no-op when button is already disabled', async () => {
  const client = makeClient();
  let patchCalled = false;
  client.patchCase = async () => {
    patchCalled = true;
    return { ok: true, status: 200 };
  };
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  const completableRow = {
    ...BASE_ROW,
    answers: {
      'q-welcome': { value: 'Yes' },
      'q-needs': { value: 'No' },
      'q-channel': { value: 'Email' },
      'q-products': { value: ['Billing'] },
    },
  };
  client.getCase = async () => completableRow;
  saveQueue.loadCase(completableRow);

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  await el.connectedCallback();

  const completeBtn = completeBtnOf(el);
  completeBtn.disabled = true; // pre-disable

  fireEvent(completeBtn, 'click');
  await flush();
  assert.equal(
    patchCalled,
    false,
    'disabled button click must not drive a completion PATCH'
  );
});

test('CORACaseReview: complete button click drives the completion PATCH', async () => {
  const client = makeClient();
  let patchCalled = false;
  client.patchCase = async () => {
    patchCalled = true;
    return { ok: true, status: 200 };
  };
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  // Provide all answers so button is visible
  const completableRow = {
    ...BASE_ROW,
    answers: {
      'q-welcome': { value: 'Yes' },
      'q-needs': { value: 'No' },
      'q-channel': { value: 'Email' },
      'q-products': { value: ['Billing'] },
    },
  };
  client.getCase = async () => completableRow;
  saveQueue.loadCase(completableRow);

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  await el.connectedCallback();

  const completeBtn = completeBtnOf(el);
  assert.equal(completeBtn.hidden, false, 'Complete button should be visible');

  fireEvent(completeBtn, 'click');
  await flush();
  assert.equal(
    patchCalled,
    true,
    'clicking the button drives a completion PATCH'
  );
});

test('CORACaseReview: complete button passes exportHash as questionBankVersion to transitionToCompleted', async () => {
  const HASH = 'sha256:fixture-hash-for-example-review';
  const client = makeClient({ exportHash: HASH });
  const completableRow = {
    ...BASE_ROW,
    answers: {
      'q-welcome': { value: 'Yes' },
      'q-needs': { value: 'No' },
      'q-channel': { value: 'Email' },
      'q-products': { value: ['Billing'] },
    },
  };
  client.getCase = async () => completableRow;
  client.getExportHash = async () => HASH;
  /** @type {any[]} */
  const patches = [];
  client.patchCase = /** @type {any} */ (
    async (/** @type {string} */ _id, /** @type {any} */ fields) => {
      patches.push(fields);
      return { ok: true, status: 200 };
    }
  );
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  saveQueue.loadCase(completableRow);

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  await el.connectedCallback();

  fireEvent(completeBtnOf(el), 'click');
  await flush();

  assert.equal(
    patches[0]?.questionBankVersion,
    HASH,
    'questionBankVersion from the export hash is included in the completion PATCH'
  );
});
