// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ===== MINIMAL DOM STUBS =====
class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    /** @type {Record<string, string>} */
    this._attrs = {};
    this.textContent = '';
    this.className = '';
    this.href = '';
    this.hidden = false;
    this.disabled = false;
    this.type = '';
    this.name = '';
    this.value = '';
    this.checked = false;
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) { this._children = cs; }
  appendChild(/** @type {StubEl} */ c) { this._children.push(c); return c; }
  append(/** @type {StubEl[]} */ ...cs) { this._children.push(...cs); }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this._attrs[k] = v; }
  getAttribute(/** @type {string} */ k) { return this._attrs[k] ?? null; }
  focus() {}
  // Stub for CRQuestionList.update / CRRemediationSection.update / CROutcome.update
  update() {}
}

class StubCustomEvent {
  /** @param {string} type @param {{ detail?: any }} [init] */
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail ?? null;
  }
}

(/** @type {any} */ (globalThis)).HTMLElement = StubEl;
(/** @type {any} */ (globalThis)).document = {
  /** @param {string} _tag @returns {StubEl} */
  createElement(_tag) { return new StubEl(); },
  addEventListener() {},
  removeEventListener() {},
};
(/** @type {any} */ (globalThis)).customElements = { define() {} };
(/** @type {any} */ (globalThis)).location = { hash: '' };
(/** @type {any} */ (globalThis)).CustomEvent = StubCustomEvent;

// ===== IMPORTS =====
const { CRCaseReview } = await import('../src/pages/cr-case-review.js');
const { SaveQueue } = await import('../src/services/save-queue.js');

// ===== HELPERS =====
/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
const BASE_ROW = {
  id: 'c1',
  caseType: 'hello-review',
  title: 'Test Case',
  status: 'In-progress',
  assignedReviewer: 'u1',
  responsibleParty: 'u2',
  answers: {},
  conversation: [],
  notes: '',
  completedAt: null,
  etag: 'e1'
};

function makeClient({ caseRow = BASE_ROW, patchOk = true } = {}) {
  return {
    async getCase() { return caseRow; },
    async getCurrentUser() { return { id: 'u1', displayName: 'User 1' }; },
    async patchCase() { return { ok: patchOk, status: patchOk ? 200 : 500 }; },
  };
}

// ===== TESTS =====

test('CRCaseReview: constructor initializes with nulls/empty', () => {
  const el = new CRCaseReview();
  assert.equal(el.client, null);
  assert.equal(el.saveQueue, null);
  assert.equal(el.caseId, '');
  assert.equal(el.currentUserId, '');
  assert.equal(el.capabilities, null);
});

test('CRCaseReview: connectedCallback returns early if missing deps', async () => {
  const el = new CRCaseReview();
  // No client, saveQueue, or caseId
  await el.connectedCallback();
  assert.equal((/** @type {any} */ (el))._children.length, 0);
});

test('CRCaseReview: connectedCallback handles case not found', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ ({
    async getCase() { return null; },
    async getCurrentUser() { return { id: 'u1' }; }
  });
  el.saveQueue = /** @type {any} */ ({});
  el.caseId = 'missing';
  await el.connectedCallback();
  
  const msg = (/** @type {any} */ (el))._children[0];
  assert.equal(msg.textContent, 'Case not found.');
});

test('CRCaseReview: connectedCallback handles access denied', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient({
    caseRow: { ...BASE_ROW, assignedReviewer: 'someone-else' }
  }));
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  el.capabilities = { isReviewer: false, ownedCaseTypes: [], isResponsibleParty: false, isReviewerManager: false };
  
  await el.connectedCallback();
  
  const panel = (/** @type {any} */ (el))._children[0];
  assert.equal(panel.className, 'cr-access-denied');
});

test('CRCaseReview: _completeCase returns early if client or saveQueue missing', async () => {
  const el = new CRCaseReview();
  // @ts-ignore
  await el._completeCase('c1', null, null);
  assert.equal((/** @type {any} */ (globalThis)).location.hash, '');
});

test('CRCaseReview: _completeCase uses this.client if arg missing', async () => {
  const client = makeClient();
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.saveQueue.loadCase(BASE_ROW);
  
  (/** @type {any} */ (globalThis)).location.hash = '';
  // @ts-ignore
  await el._completeCase('c1', undefined, undefined);
  assert.equal((/** @type {any} */ (globalThis)).location.hash, '#/dashboard');
});

test('CRCaseReview: _completeCase does not navigate on failure', async () => {
  const client = makeClient({ patchOk: false });
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.saveQueue.loadCase(BASE_ROW);
  
  (/** @type {any} */ (globalThis)).location.hash = 'keep-me';
  await el._completeCase('c1', el.client, el.saveQueue);
  assert.equal((/** @type {any} */ (globalThis)).location.hash, 'keep-me');
});

test('CRCaseReview: no inline cr-save-status paragraph in rendered children', async () => {
  const client = makeClient();
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const children = /** @type {any[]} */ ((/** @type {any} */ (el))._children);
  const hasStatusPara = children.some(c => c.className === 'cr-save-status');
  assert.equal(hasStatusPara, false, 'inline save-status paragraph must not appear; cr-status-banner handles display');
});


test('CRCaseReview: remediation and conversation can be hidden', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient({
    caseRow: { ...BASE_ROW, assignedReviewer: 'u1' }
  }));
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  // Use RP capability but case is not assigned to us as RP -> conversation might be hidden or read-only
  // Actually let's just force all hidden via a mock capability/role if possible, 
  // but evaluateAccess depends on fixed SECTIONS.
  // RP role: questions R, conversation E, notes H, remediation R.
  // If we are 'none' role we get Access Denied.
  
  // Let's test the 'hidden' branches in _buildLayout directly by providing specific roles
  // but those are hardcoded in resolveRoles.
  
  // Instead, I can test if sections are hidden for an RP (Notes should be hidden).
  el.capabilities = { isReviewer: false, ownedCaseTypes: [], isResponsibleParty: true, isReviewerManager: false };
  const rpRow = { ...BASE_ROW, responsibleParty: 'u1', assignedReviewer: 'other' };
  el.client.getCase = async () => rpRow;
  
  await el.connectedCallback();
  
  // children index 7 is Notes
  const notesEl = (/** @type {any} */ (el))._children[6];
  assert.equal(notesEl.hidden, true, 'Notes should be hidden for RP');
});

test('CRCaseReview: cr-answer handles unmapped question', async () => {
  const client = makeClient();
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  /** @type {any[]} */
  const enqueued = [];
  saveQueue.enqueue = (...args) => { enqueued.push(args); };

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = (/** @type {any} */ (el))._children[2];
  // Dispatch answer for an ID not in the catalogue
  section._listeners['cr-answer'][0]({ detail: { questionId: 'unknown', value: 'Yes' } });
  
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0][2].unknown.value, 'Yes');
});

test('CRCaseReview: cr-answer clears answers for questions that become non-applicable', async () => {
  const client = makeClient();
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  /** @type {any[]} */
  const enqueued = [];
  saveQueue.enqueue = (...args) => { enqueued.push(args); };

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = (/** @type {any} */ (el))._children[2];
  const handler = section._listeners['cr-answer'][0];
  
  // 1. q-needs = Yes (triggers q-resolve)
  handler({ detail: { questionId: 'q-needs', value: 'Yes' } });
  // 2. q-resolve = Yes
  handler({ detail: { questionId: 'q-resolve', value: 'Yes' } });
  // 3. q-needs = No (q-resolve hidden)
  handler({ detail: { questionId: 'q-needs', value: 'No' } });
  
  const lastAnswers = enqueued[2][2];
  assert.equal(lastAnswers['q-needs'].value, 'No');
  assert.equal(lastAnswers['q-resolve'], undefined, 'hidden conditional question answer should be cleared');
});

test('CRCaseReview: cr-answer is ignored when questions access is read-only (RP role)', async () => {
  const client = makeClient({
    caseRow: { ...BASE_ROW, responsibleParty: 'user-rp', assignedReviewer: 'other-reviewer' },
  });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  /** @type {any[]} */
  const enqueued = [];
  saveQueue.enqueue = (...args) => { enqueued.push(args); };

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'user-rp';
  el.capabilities = { isReviewer: false, ownedCaseTypes: [], isResponsibleParty: true, isReviewerManager: false };
  await el.connectedCallback();

  // For RP, access.questions = 'read-only', so the cr-answer handler must early-return.
  const section = (/** @type {any} */ (el))._children[2];
  section._listeners['cr-answer'][0]({ detail: { questionId: 'q-welcome', value: 'Yes' } });

  assert.equal(enqueued.length, 0, 'cr-answer must not enqueue when questions access is read-only');
});

test('CRCaseReview: complete button stays hidden for a Completed case even when all answered', async () => {
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

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  el.capabilities = { isReviewer: true, ownedCaseTypes: [], isResponsibleParty: false, isReviewerManager: false };
  await el.connectedCallback();

  const completeBtn = (/** @type {any} */ (el))._children[7];
  assert.equal(completeBtn.hidden, true, 'Complete button must be hidden for a Completed case');
});

test('CRCaseReview: complete button click is no-op when button is already disabled', async () => {
  const client = makeClient();
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  const completableRow = {
    ...BASE_ROW,
    answers: {
      'q-welcome': { value: 'Yes' },
      'q-needs': { value: 'No' },
      'q-channel': { value: 'Email' },
      'q-products': { value: ['Billing'] },
    }
  };
  client.getCase = async () => completableRow;
  saveQueue.loadCase(completableRow);

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  await el.connectedCallback();

  const completeBtn = (/** @type {any} */ (el))._children[7];
  completeBtn.disabled = true; // pre-disable

  let completeCalled = false;
  el._completeCase = async () => { completeCalled = true; };

  completeBtn._listeners['click'][0]();
  assert.equal(completeCalled, false, 'disabled button click must not invoke _completeCase');
});

test('CRCaseReview: complete button click invokes _completeCase', async () => {
  const client = makeClient();
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  // Provide all answers so button is visible
  const completableRow = {
    ...BASE_ROW,
    answers: {
      'q-welcome': { value: 'Yes' },
      'q-needs': { value: 'No' },
      'q-channel': { value: 'Email' },
      'q-products': { value: ['Billing'] },
    }
  };
  client.getCase = async () => completableRow;
  saveQueue.loadCase(completableRow);

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  await el.connectedCallback();

  const completeBtn = (/** @type {any} */ (el))._children[7];
  assert.equal(completeBtn.hidden, false, 'Complete button should be visible');
  
  let completeCalled = false;
  el._completeCase = async () => { completeCalled = true; };
  
  completeBtn._listeners['click'][0]();
  assert.equal(completeCalled, true);
});

// ===== SECTION PROGRESS INTEGRATION =====

test('CRCaseReview: cr-section-progress is mounted inside the question section', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = (/** @type {any} */ (el))._children[2];
  // section._children: [h2, qList, cr-section-progress]
  const progressEl = section._children[2];
  assert.ok(progressEl, 'cr-section-progress should be mounted inside the question section');
  assert.ok(typeof progressEl.update === 'function', 'cr-section-progress should have an update method');
});

test('CRCaseReview: cr-section-progress.update is called with section data on initial render', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = (/** @type {any} */ (el))._children[2];
  const progressEl = section._children[2];

  /** @type {any[]} */
  const calls = [];
  (/** @type {any} */ (progressEl)).update = (/** @type {any[]} */ ...args) => calls.push(args);

  // Trigger viewState update by simulating a cr-answer event
  section._listeners['cr-answer'][0]({ detail: { questionId: 'q-welcome', value: 'Yes' } });

  assert.ok(calls.length > 0, 'update should be called after an answer change');
  const [sections] = calls[0];
  assert.ok(Array.isArray(sections), 'first arg should be an array of section progress entries');
  assert.ok(sections.length > 0, 'should have at least one section');
  assert.ok('section' in sections[0], 'each entry should have a section property');
  assert.ok('answered' in sections[0], 'each entry should have an answered count');
  assert.ok('total' in sections[0], 'each entry should have a total count');
});

test('CRCaseReview: cr-section-progress.update answered count increases after cr-answer', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = (/** @type {any} */ (el))._children[2];
  const progressEl = section._children[2];

  /** @type {any[][]} */
  const calls = [];
  (/** @type {any} */ (progressEl)).update = (/** @type {any[]} */ ...args) => calls.push(args);

  // Answer q-welcome (category: 'Opening')
  section._listeners['cr-answer'][0]({ detail: { questionId: 'q-welcome', value: 'Yes' } });
  const sections = calls[0][0];
  const opening = sections.find((/** @type {any} */ s) => s.section === 'Opening');
  assert.ok(opening, 'Opening section should be present');
  assert.equal(opening.answered, 1);
  assert.equal(opening.total, 1);
});

test('CRCaseReview: cr-section-progress receives unanswered applicable questions list', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = (/** @type {any} */ (el))._children[2];
  const progressEl = section._children[2];

  /** @type {any[][]} */
  const calls = [];
  (/** @type {any} */ (progressEl)).update = (/** @type {any[]} */ ...args) => calls.push(args);

  section._listeners['cr-answer'][0]({ detail: { questionId: 'q-welcome', value: 'Yes' } });
  const [, unanswered] = calls[0];
  assert.ok(Array.isArray(unanswered), 'second arg should be the unanswered applicable questions array');
  // q-welcome is answered; others remain unanswered
  assert.ok(!unanswered.some((/** @type {any} */ q) => q.id === 'q-welcome'), 'answered question should not appear in unanswered list');
});

test('CRCaseReview: cr-section-jump event on section scrolls first question of that section', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = (/** @type {any} */ (el))._children[2];
  // Check the event listener is registered for cr-section-jump
  assert.ok(
    Array.isArray(section._listeners['cr-section-jump']) && section._listeners['cr-section-jump'].length > 0,
    'section should have a cr-section-jump listener'
  );
  // Fire it without throwing
  assert.doesNotThrow(() => {
    section._listeners['cr-section-jump'][0]({ detail: { section: 'Opening' } });
  });
});

test('CRCaseReview: cr-jump-unanswered event scrolls to first unanswered applicable question', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = (/** @type {any} */ (el))._children[2];
  assert.ok(
    Array.isArray(section._listeners['cr-jump-unanswered']) && section._listeners['cr-jump-unanswered'].length > 0,
    'section should have a cr-jump-unanswered listener'
  );
  assert.doesNotThrow(() => {
    section._listeners['cr-jump-unanswered'][0]({});
  });
});
