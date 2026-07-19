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
  const picker = remediation.querySelector('cora-people-picker');
  assert.ok(picker, 'Assigned Reviewer sees the attribution people picker');
  assert.equal(
    picker.client,
    client,
    'client is handed to the rendered picker'
  );

  fireEvent(picker, 'cora-person-selected', {
    detail: {
      loginName: 'jsmith',
      displayName: 'Jane Smith',
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
  const quickPick = remediation.querySelector('.cora-attribute-responsible');
  assert.equal(
    quickPick?.textContent,
    'Responsible Party — rparty',
    'the bare account is rendered as the quick-pick display name until the page-load resolver lands (#97)'
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
  const clear = remediation.querySelector('.cora-attribute-clear');
  assert.ok(clear, 'clear-attribution control is rendered');
  fireEvent(clear, 'click');

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

test('CORACaseReview: does not render attribution controls when no Answer fails', async () => {
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
  assert.equal(remediation.querySelector('.cora-attribute-menu'), null);

  assert.equal(
    enqueued.length,
    0,
    'no persistence occurs when there is no failed Answer to attribute'
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
  const capture = remediation.querySelector('cora-capture-groups');
  assert.ok(capture, 'configured capture groups render in the Issues panel');
  assert.ok(capture.groups.length > 0, 'configured groups reach the control');
  assert.equal(
    capture.canCapture,
    true,
    'Assigned Reviewer receives an editable capture control'
  );
});

test('CORACaseReview: editing the rendered capture control records the value and persists', async () => {
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
  const capture = remediation.querySelector('cora-capture-groups');
  assert.ok(capture, 'capture control is rendered');
  fireEvent(capture, 'cora-capture', {
    detail: {
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

test('CORACaseReview: the rendered capture control ignores an unknown field key', async () => {
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
  const capture = remediation.querySelector('cora-capture-groups');
  assert.ok(capture, 'capture control is rendered');
  fireEvent(capture, 'cora-capture', {
    detail: { fieldKey: 'ghost', value: 'x' },
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
  const capture = remediation.querySelector('cora-capture-groups');
  assert.ok(capture, 'read-only capture values remain rendered');
  assert.equal(capture.canCapture, false, 'capture is frozen at completion');
  fireEvent(capture, 'cora-capture', {
    detail: { fieldKey: 'rootCause', value: 'x' },
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
    remediation.querySelector('.cora-attribute-menu'),
    null,
    'Responsible Party receives no attribution controls'
  );
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
    remediation.querySelector('.cora-attribute-current')?.textContent,
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
    remediation.querySelector('.cora-attribute-current')?.textContent,
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
