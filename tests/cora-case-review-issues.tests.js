// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_ROW,
  CaseReviewHarness,
  SaveQueue,
  fireEvent,
  makeClient,
  remediationOf,
} from './helpers/cora-case-review.js';

// Capability: attribution, capture, and responsible-party behavior.

test('CORACaseReview: Assigned Reviewer can set an Attributed Party, persisting via SaveQueue', async () => {
  const failRow = {
    ...BASE_ROW,
    assignedReviewer: 'u1',
    answers: { 'q-needs': { value: 'No' } },
  };
  const client = makeClient({ caseRow: failRow });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  /** @type {any[]} */
  const enqueued = [];
  saveQueue.enqueue = (...args) => {
    enqueued.push(args);
  };

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  await el.connectedCallback();

  const remediation = remediationOf(el);
  assert.equal(
    remediation.canAttribute,
    true,
    'Assigned Reviewer on In-progress case may attribute'
  );
  assert.equal(
    remediation.client,
    client,
    'client is handed to the section for the picker'
  );

  fireEvent(remediation, 'cora-attribute', {
    detail: {
      questionId: 'q-needs',
      attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
    },
  });

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0][1], 'answers');
  assert.deepEqual(enqueued[0][2]['q-needs'].attributedParty, {
    loginName: 'jsmith',
    displayName: 'Jane Smith',
  });
});

test("CORACaseReview: forwards the Case's Responsible Party to the remediation section as a quick-pick", async () => {
  const failRow = {
    ...BASE_ROW,
    assignedReviewer: 'u1',
    responsibleParty: 'rparty',
    answers: { 'q-needs': { value: 'No' } },
  };
  const client = makeClient({ caseRow: failRow });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  await el.connectedCallback();

  const remediation = remediationOf(el);
  assert.deepEqual(
    remediation.responsibleParty,
    { loginName: 'rparty', displayName: 'rparty' },
    'bare account doubles as the display name until the page-load resolver lands (#97)'
  );
});

test('CORACaseReview: clearing an Attributed Party strips it from the Answer and persists', async () => {
  const failRow = {
    ...BASE_ROW,
    assignedReviewer: 'u1',
    answers: {
      'q-needs': {
        value: 'No',
        attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
      },
    },
  };
  const client = makeClient({ caseRow: failRow });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  /** @type {any[]} */
  const enqueued = [];
  saveQueue.enqueue = (...args) => {
    enqueued.push(args);
  };

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  await el.connectedCallback();

  const remediation = remediationOf(el);
  fireEvent(remediation, 'cora-attribute', {
    detail: { questionId: 'q-needs', attributedParty: null },
  });

  assert.equal(enqueued.length, 1);
  assert.equal(
    'attributedParty' in enqueued[0][2]['q-needs'],
    false,
    'attributedParty removed from the Answer'
  );
  assert.equal(
    enqueued[0][2]['q-needs'].value,
    'No',
    'the rest of the Answer is preserved'
  );
});

test('CORACaseReview: cora-attribute is ignored when the referenced Answer is missing', async () => {
  const client = makeClient({
    caseRow: { ...BASE_ROW, assignedReviewer: 'u1' },
  });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  /** @type {any[]} */
  const enqueued = [];
  saveQueue.enqueue = (...args) => {
    enqueued.push(args);
  };

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  await el.connectedCallback();

  const remediation = remediationOf(el);
  fireEvent(remediation, 'cora-attribute', {
    detail: {
      questionId: 'q-nonexistent',
      attributedParty: { loginName: 'x', displayName: 'X' },
    },
  });

  assert.equal(
    enqueued.length,
    0,
    'no persistence when there is no Answer to attribute'
  );
});

test('CORACaseReview: passes the Case Type captureGroups to the remediation section, editable for the Assigned Reviewer', async () => {
  const failRow = {
    ...BASE_ROW,
    assignedReviewer: 'u1',
    answers: { 'q-needs': { value: 'No' } },
  };
  const client = makeClient({ caseRow: failRow });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  await el.connectedCallback();

  const remediation = remediationOf(el);
  assert.ok(
    remediation.captureGroups.length > 0,
    'captureGroups forwarded from config'
  );
  assert.equal(
    remediation.canCapture,
    true,
    'Assigned Reviewer on In-progress case may capture'
  );
});

test('CORACaseReview: a cora-capture event records the value into Answer.capture and persists', async () => {
  const failRow = {
    ...BASE_ROW,
    assignedReviewer: 'u1',
    answers: { 'q-needs': { value: 'No' } },
  };
  const client = makeClient({ caseRow: failRow });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  /** @type {any[]} */
  const enqueued = [];
  saveQueue.enqueue = (...args) => {
    enqueued.push(args);
  };

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  await el.connectedCallback();

  const remediation = remediationOf(el);
  fireEvent(remediation, 'cora-capture', {
    detail: {
      questionId: 'q-needs',
      fieldKey: 'rootCause',
      value: 'Agent rushed',
    },
  });

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0][1], 'answers');
  assert.deepEqual(enqueued[0][2]['q-needs'].capture, {
    rootCause: 'Agent rushed',
  });
});

test('CORACaseReview: a cora-capture for an unknown field key is ignored', async () => {
  const failRow = {
    ...BASE_ROW,
    assignedReviewer: 'u1',
    answers: { 'q-needs': { value: 'No' } },
  };
  const client = makeClient({ caseRow: failRow });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  /** @type {any[]} */
  const enqueued = [];
  saveQueue.enqueue = (...args) => {
    enqueued.push(args);
  };

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  await el.connectedCallback();

  const remediation = remediationOf(el);
  fireEvent(remediation, 'cora-capture', {
    detail: { questionId: 'q-needs', fieldKey: 'ghost', value: 'x' },
  });
  fireEvent(remediation, 'cora-capture', {
    detail: { questionId: 'q-missing', fieldKey: 'rootCause', value: 'x' },
  });

  assert.equal(
    enqueued.length,
    0,
    'no persistence for an unknown field or missing Answer'
  );
});

test('CORACaseReview: capture is frozen (ignored) on a Completed case', async () => {
  const completedRow = {
    ...BASE_ROW,
    status: /** @type {'Completed'} */ ('Completed'),
    assignedReviewer: 'u1',
    answers: { 'q-needs': { value: 'No' } },
  };
  const client = makeClient({ caseRow: completedRow });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  saveQueue.loadCase(completedRow);
  /** @type {any[]} */
  const enqueued = [];
  saveQueue.enqueue = (...args) => {
    enqueued.push(args);
  };

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  await el.connectedCallback();

  const remediation = remediationOf(el);
  assert.equal(
    remediation.canCapture,
    false,
    'capture is frozen at completion'
  );
  fireEvent(remediation, 'cora-capture', {
    detail: { questionId: 'q-needs', fieldKey: 'rootCause', value: 'x' },
  });
  assert.equal(enqueued.length, 0, 'no persistence when capture is frozen');
});

test('CORACaseReview: non-assigned viewer cannot attribute (read-only)', async () => {
  const failRow = {
    ...BASE_ROW,
    assignedReviewer: 'other-reviewer',
    responsibleParty: 'user-rp',
    answers: { 'q-needs': { value: 'No' } },
  };
  const client = makeClient({ caseRow: failRow });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  /** @type {any[]} */
  const enqueued = [];
  saveQueue.enqueue = (...args) => {
    enqueued.push(args);
  };

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'user-rp';
  el.capabilities = {
    isReviewer: false,
    ownedCaseTypes: [],
    isAdviser: true,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  await el.connectedCallback();

  const remediation = remediationOf(el);
  assert.equal(
    remediation.canAttribute,
    false,
    'Responsible Party cannot attribute'
  );

  fireEvent(remediation, 'cora-attribute', {
    detail: {
      questionId: 'q-needs',
      attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
    },
  });
  assert.equal(
    enqueued.length,
    0,
    'non-assigned viewer must not enqueue an attribution'
  );
});

test('CORACaseReview: resolves stored Attributed Party names to authoritative display names at load', async () => {
  const failRow = {
    ...BASE_ROW,
    assignedReviewer: 'u1',
    answers: {
      'q-needs': {
        value: 'No',
        attributedParty: { loginName: 'jsmith', displayName: 'jsmith' },
      },
    },
  };
  /** @type {string[]} */
  let askedFor = [];
  const client = makeClient({
    caseRow: failRow,
    resolveUsers: async (/** @type {string[]} */ accounts) => {
      askedFor = accounts;
      return { jsmith: 'Jane Smith' };
    },
  });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  await el.connectedCallback();

  assert.deepEqual(
    askedFor,
    ['jsmith'],
    'collects the unique attributed-party accounts'
  );
  const remediation = remediationOf(el);
  assert.equal(
    remediation._update[1]['q-needs'].attributedParty.displayName,
    'Jane Smith',
    'authoritative display name is rendered after resolution'
  );
});

test('CORACaseReview: collects unique Attributed Party accounts across answers before resolving', async () => {
  const failRow = {
    ...BASE_ROW,
    assignedReviewer: 'u1',
    answers: {
      'q-needs': {
        value: 'No',
        attributedParty: { loginName: 'jsmith', displayName: 'jsmith' },
      },
      'q-welcome': {
        value: 'No',
        attributedParty: { loginName: 'jsmith', displayName: 'jsmith' },
      },
    },
  };
  /** @type {string[]} */
  let askedFor = [];
  const client = makeClient({
    caseRow: failRow,
    resolveUsers: async (/** @type {string[]} */ accounts) => {
      askedFor = accounts;
      return { jsmith: 'Jane Smith' };
    },
  });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  await el.connectedCallback();

  assert.deepEqual(
    askedFor,
    ['jsmith'],
    'the repeated account is requested once'
  );
});

test('CORACaseReview: keeps the cached Attributed Party name when resolution returns null', async () => {
  const failRow = {
    ...BASE_ROW,
    assignedReviewer: 'u1',
    answers: {
      'q-needs': {
        value: 'No',
        attributedParty: { loginName: 'ghost', displayName: 'Cached Ghost' },
      },
    },
  };
  const client = makeClient({
    caseRow: failRow,
    resolveUsers: async () => ({ ghost: null }),
  });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  await el.connectedCallback();

  const remediation = remediationOf(el);
  assert.equal(
    remediation._update[1]['q-needs'].attributedParty.displayName,
    'Cached Ghost',
    'cached display name is retained as the fallback'
  );
});

test('CORACaseReview: does not resolve users when no Answer carries an Attributed Party', async () => {
  let called = false;
  const client = makeClient({
    caseRow: {
      ...BASE_ROW,
      assignedReviewer: 'u1',
      answers: { 'q-needs': { value: 'No' } },
    },
    resolveUsers: async () => {
      called = true;
      return {};
    },
  });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  await el.connectedCallback();

  assert.equal(
    called,
    false,
    'no resolution round-trip when there is nothing to resolve'
  );
});
