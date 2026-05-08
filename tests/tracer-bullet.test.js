// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ===== MINIMAL DOM STUBS =====
// Must be set before any import that transitively loads cr-element.js,
// because CRElement does: const Base = globalThis.HTMLElement at eval time.

class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    this.textContent = '';
    this.className = '';
    this.href = '';
    this.hidden = false;
    this.disabled = false;
    this.type = '';
    this.name = '';
    this.value = '';
    this.checked = false;
    /** @type {any} */
    this._updateArgs = null;
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) { this._children = cs; }
  appendChild(/** @type {StubEl} */ c) { this._children.push(c); return c; }
  append(/** @type {StubEl[]} */ ...cs) { this._children.push(...cs); }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
  // Stub for CRQuestionList.update / CRRemediationSection.update / CROutcome.update
  update(/** @type {any} */ a1, /** @type {any} */ a2, /** @type {any} */ a3) {
    this._updateArgs = { a1, a2, a3 };
  }
}

class StubCustomEvent {
  /**
   * @param {string} type
   * @param {{ detail?: unknown, bubbles?: boolean }} [opts]
   */
  constructor(type, opts = {}) {
    this.type = type;
    this.detail = opts.detail ?? null;
    this.bubbles = opts.bubbles ?? false;
  }
}

(/** @type {any} */ (globalThis)).HTMLElement = StubEl;
(/** @type {any} */ (globalThis)).document = {
  /** @param {string} _tag @returns {StubEl} */
  createElement(_tag) { return new StubEl(); },
  addEventListener() {},
  removeEventListener() {},
  hidden: false,
};
(/** @type {any} */ (globalThis)).customElements = { define() {} };
(/** @type {any} */ (globalThis)).location = { hash: '' };
(/** @type {any} */ (globalThis)).CustomEvent = StubCustomEvent;

// ===== IMPORTS (after stubs are in place) =====
const { allApplicableAnswered } = await import('../src/applicability-evaluator.js');
const { MockSharePointClient } = await import('../src/mock-sharepoint-client.js');
const { SaveQueue } = await import('../src/save-queue.js');
const { CRDashboard } = await import('../src/cr-dashboard.js');
const { CRCaseReview } = await import('../src/cr-case-review.js');
const { cases } = await import('../dev/fixtures/cases.js');
const { questionDefinitions } = await import('../dev/fixtures/question-definitions.js');
const { personas } = await import('../dev/fixtures/personas.js');

// ===== FIXTURES =====
/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

const caseUntouched = cases[0]; // case-1: no answers
const caseCompletable = cases[2]; // case-3: all applicable questions answered

/** @type {QuestionDefinition[]} */
const CATALOGUE = questionDefinitions; // q-welcome, q-needs, q-resolve(conditional)

// Minimal client stub for component tests
/**
 * @param {{ patchReturn?: import('../src/sharepoint-client.js').PatchResult, getRow?: CaseRow }} [opts]
 */
function makeStubClient({ patchReturn = { ok: true, status: 200 }, getRow = caseCompletable } = {}) {
  /** @type {{ id: string, fields: Partial<CaseRow>, etag: string }[]} */
  const patchCalls = [];
  return {
    patchCalls,
    async getCase(/** @type {string} */ _id) { return { ...getRow }; },
    async patchCase(/** @type {string} */ id, /** @type {Partial<CaseRow>} */ fields, /** @type {string} */ etag) {
      patchCalls.push({ id, fields, etag });
      return patchReturn;
    },
    async listCases(/** @type {import('../src/sharepoint-client.js').ListCasesFilter} */ filter) {
      return cases.filter(c => {
        if (filter.status !== undefined && c.status !== filter.status) return false;
        if (filter.assignedReviewer !== undefined && c.assignedReviewer !== filter.assignedReviewer) return false;
        return true;
      });
    },
    async getQuestionDefinitions(/** @type {string[]} */ _ids) { return []; },
    async getCurrentUserGroups() { return []; },
    async getCurrentUser() { return { id: 'user-reviewer', displayName: 'Alex Reviewer' }; },
  };
}

// ===== TESTS: allApplicableAnswered =====

test('allApplicableAnswered: returns true for empty catalogue', () => {
  assert.equal(allApplicableAnswered([], {}), true);
});

test('allApplicableAnswered: returns true when all non-conditional questions answered', () => {
  const answers = {
    'q-welcome': { value: 'Yes' },
    'q-needs': { value: 'No' },
    'q-channel': { value: 'Phone' },
    'q-products': { value: ['Billing'] },
  };
  // q-resolve not applicable because q-needs !== Yes
  assert.equal(allApplicableAnswered(CATALOGUE, answers), true);
});

test('allApplicableAnswered: returns false when an applicable question is unanswered', () => {
  const answers = { 'q-welcome': { value: 'Yes' } }; // q-needs unanswered
  assert.equal(allApplicableAnswered(CATALOGUE, answers), false);
});

test('allApplicableAnswered: conditional question unanswered → false when its trigger is met', () => {
  // q-needs = Yes triggers q-resolve; q-resolve unanswered → false
  const answers = {
    'q-welcome': { value: 'Yes' },
    'q-needs': { value: 'Yes' },
    // q-resolve deliberately omitted
  };
  assert.equal(allApplicableAnswered(CATALOGUE, answers), false);
});

test('allApplicableAnswered: all applicable questions answered → true', () => {
  const answers = {
    'q-welcome': { value: 'Yes' },
    'q-needs': { value: 'Yes' },
    'q-resolve': { value: 'Yes' },
    'q-channel': { value: 'Phone' },
    'q-products': { value: ['Billing'] },
  };
  assert.equal(allApplicableAnswered(CATALOGUE, answers), true);
});

// ===== TESTS: MockSharePointClient.getCurrentUser =====

test('MockSharePointClient: getCurrentUser returns the persona userId and displayName', async () => {
  const client = new MockSharePointClient({
    cases: [],
    questionDefinitions: [],
    personas,
    persona: 'reviewer',
  });
  const user = await client.getCurrentUser();
  assert.equal(user.id, personas.reviewer.userId);
  assert.equal(user.displayName, personas.reviewer.displayName);
});

// ===== TESTS: SaveQueue.getEtag =====

test('SaveQueue: getEtag returns the ETag registered via loadCase', () => {
  const q = new SaveQueue(/** @type {any} */ (makeStubClient()));
  q.loadCase({ ...caseCompletable, etag: 'etag-from-server' });
  assert.equal(q.getEtag(caseCompletable.id), 'etag-from-server');
});

test('SaveQueue: getEtag returns empty string for unregistered caseId', () => {
  const q = new SaveQueue(/** @type {any} */ (makeStubClient()));
  assert.equal(q.getEtag('no-such-case'), '');
});

// ===== TESTS: CRDashboard =====

test('CRDashboard: connectedCallback calls listCases with In-progress and assignedReviewer filter', async () => {
  const listCalls = /** @type {import('../src/sharepoint-client.js').ListCasesFilter[]} */ ([]);
  const client = {
    async listCases(/** @type {import('../src/sharepoint-client.js').ListCasesFilter} */ f) {
      listCalls.push(f);
      return [];
    },
    async getCurrentUser() { return { id: 'user-reviewer', displayName: 'Alex' }; },
    async getCase() { return null; },
    async patchCase() { return { ok: true, status: 200 }; },
    async getQuestionDefinitions() { return []; },
    async getCurrentUserGroups() { return []; },
  };

  const el = new CRDashboard();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  await el.connectedCallback();

  assert.equal(listCalls.length, 1);
  assert.deepEqual(listCalls[0], { status: 'In-progress', assignedReviewer: 'user-reviewer' });
});

test('CRDashboard: renders one list item per case returned by listCases', async () => {
  const el = new CRDashboard();
  el.client = /** @type {any} */ (makeStubClient());
  el.currentUserId = 'user-reviewer';
  await el.connectedCallback();

  // el._children = [h1, ul] — all 3 fixture cases are assigned to user-reviewer
  const ul = (/** @type {any} */ (el))._children[1];
  assert.ok(ul, 'list element should exist');
  assert.equal(ul._children.length, 3, 'one li per In-progress case');
});

test('CRDashboard: owner group causes cr-owner-summary to be added to layout', async () => {
  const el = new CRDashboard();
  el.client = /** @type {any} */ (makeStubClient());
  el.currentUserId = 'user-owner';
  el.userGroups = ['Reviewers', 'CaseTypeOwners-HelloReview'];
  await el.connectedCallback();

  // _children: [h1, ul, allocationEl, ownerSection]
  const ownerSection = (/** @type {any} */ (el))._children[3];
  assert.ok(ownerSection, 'owner section should exist');
  assert.deepEqual(ownerSection.ownedCaseTypes, ['hello-review']);
  assert.ok(ownerSection.client !== null, 'client should be set on owner section');
});

test('CRDashboard: reviewer-only groups do not show cr-owner-summary', async () => {
  const el = new CRDashboard();
  el.client = /** @type {any} */ (makeStubClient());
  el.currentUserId = 'user-reviewer';
  el.userGroups = ['Reviewers'];
  await el.connectedCallback();

  // _children: [h1, ul, allocationEl] — no owner section
  assert.equal((/** @type {any} */ (el))._children.length, 3);
});

test('CRDashboard: user with no groups does not show cr-owner-summary', async () => {
  const el = new CRDashboard();
  el.client = /** @type {any} */ (makeStubClient());
  el.currentUserId = 'user-reviewer';
  // userGroups defaults to [] — should not crash and should not show owner section
  await el.connectedCallback();

  // _children: [h1, ul, allocationEl] — no owner section
  assert.equal((/** @type {any} */ (el))._children.length, 3);
});

test('CRDashboard: layout always includes a cr-allocation element at index 2', async () => {
  const el = new CRDashboard();
  el.client = /** @type {any} */ (makeStubClient());
  el.currentUserId = 'user-reviewer';
  el.eligibleCaseTypes = ['hello-review'];
  await el.connectedCallback();

  // _children: [h1, ul, allocationEl]
  const allocationEl = (/** @type {any} */ (el))._children[2];
  assert.ok(allocationEl, 'allocation element should exist at index 2');
  assert.equal(allocationEl.currentUserId, 'user-reviewer');
  assert.deepEqual(allocationEl.eligibleCaseTypes, ['hello-review']);
});

// ===== TESTS: CRCaseReview =====

test('CRCaseReview: connectedCallback calls getCase and saveQueue.loadCase', async () => {
  const getCalls = /** @type {string[]} */ ([]);
  const loadCalls = /** @type {CaseRow[]} */ ([]);

  const client = {
    async getCase(/** @type {string} */ id) { getCalls.push(id); return { ...caseCompletable }; },
    async patchCase() { return { ok: true, status: 200 }; },
    async listCases() { return []; },
    async getQuestionDefinitions() { return []; },
    async getCurrentUserGroups() { return []; },
    async getCurrentUser() { return { id: 'user-reviewer', displayName: 'Alex' }; },
  };

  const saveQueue = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });
  const origLoad = saveQueue.loadCase.bind(saveQueue);
  saveQueue.loadCase = (/** @type {CaseRow} */ row) => { loadCalls.push(row); return origLoad(row); };

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = caseCompletable.id;

  await el.connectedCallback();

  assert.deepEqual(getCalls, [caseCompletable.id]);
  assert.equal(loadCalls.length, 1);
  assert.equal(loadCalls[0].id, caseCompletable.id);
});

test('CRCaseReview: complete button is hidden when not all applicable questions answered', async () => {
  const client = makeStubClient({ getRow: caseUntouched });
  const saveQueue = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = caseUntouched.id;

  await el.connectedCallback();

  // children: header(0), statusEl(1), section(2), remediationSection(3), outcomeEl(4), conversationEl(5), notesEl(6), completeBtn(7)
  const completeBtn = (/** @type {any} */ (el))._children[7];
  assert.equal(completeBtn.hidden, true);
});

test('CRCaseReview: complete button is visible when all applicable questions answered', async () => {
  const client = makeStubClient({ getRow: caseCompletable });
  const saveQueue = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = caseCompletable.id;

  await el.connectedCallback();

  // children: header(0), statusEl(1), section(2), remediationSection(3), outcomeEl(4), conversationEl(5), notesEl(6), completeBtn(7)
  const completeBtn = (/** @type {any} */ (el))._children[7];
  assert.equal(completeBtn.hidden, false);
});

test('CRCaseReview: _completeCase patches status:Completed with completedAt using stored ETag', async () => {
  const client = makeStubClient();
  const saveQueue = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });
  saveQueue.loadCase(caseCompletable);

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = caseCompletable.id;

  (/** @type {any} */ (globalThis)).location.hash = '';
  await el._completeCase(caseCompletable.id);

  assert.equal(client.patchCalls.length, 1);
  assert.equal(client.patchCalls[0].id, caseCompletable.id);
  assert.equal(client.patchCalls[0].fields.status, 'Completed');
  assert.ok(typeof client.patchCalls[0].fields.completedAt === 'string',
    'completedAt should be an ISO string');
  assert.equal(client.patchCalls[0].etag, caseCompletable.etag);
});

test('CRCaseReview: cr-answer with failing value materializes remediationActions into the saved Answer', async () => {
  const client = makeStubClient({ getRow: caseUntouched });
  const saveQueue = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });

  /** @type {{ id: string, fields: any }[]} */
  const enqueued = [];
  const origEnqueue = saveQueue.enqueue.bind(saveQueue);
  saveQueue.enqueue = (/** @type {string} */ id, /** @type {string} */ field, /** @type {unknown} */ val) => {
    enqueued.push({ id, fields: { [field]: val } });
    return origEnqueue(id, field, val);
  };

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = caseUntouched.id;
  await el.connectedCallback();

  // Find the section element and dispatch a cr-answer for q-needs = No (a failure with remediationActions)
  const section = (/** @type {any} */ (el))._children[2];
  const handler = section._listeners['cr-answer'][0];
  handler({ detail: { questionId: 'q-needs', value: 'No' } });

  assert.equal(enqueued.length, 1);
  const saved = enqueued[0].fields.answers;
  assert.equal(saved['q-needs'].value, 'No');
  assert.ok(Array.isArray(saved['q-needs'].remediationActions), 'remediationActions should be materialized');
  assert.equal(saved['q-needs'].remediationActions.length, 1);
  assert.equal(saved['q-needs'].remediationActions[0].text, 'Retrain agent on needs-identification protocol.');
  assert.equal(saved['q-needs'].remediationActions[0].completed, false);
});

test('CRCaseReview: changing a failed Answer to a passing value strips remediationActions', async () => {
  const failed = /** @type {CaseRow} */ ({
    ...caseUntouched,
    answers: {
      'q-needs': {
        value: 'No',
        remediationActions: [{ id: 'q-needs-ra-0', text: 'old', completed: false }],
      },
    },
  });
  const client = makeStubClient({ getRow: failed });
  const saveQueue = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });

  /** @type {any[]} */
  const enqueued = [];
  const origEnqueue = saveQueue.enqueue.bind(saveQueue);
  saveQueue.enqueue = (/** @type {string} */ id, /** @type {string} */ f, /** @type {unknown} */ v) => {
    enqueued.push({ id, field: f, value: v });
    return origEnqueue(id, f, v);
  };

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = failed.id;
  await el.connectedCallback();

  const section = (/** @type {any} */ (el))._children[2];
  section._listeners['cr-answer'][0]({ detail: { questionId: 'q-needs', value: 'Yes' } });

  assert.equal(enqueued.length, 1);
  const saved = enqueued[0].value;
  assert.equal(saved['q-needs'].value, 'Yes');
  assert.equal(saved['q-needs'].remediationActions, undefined);
});

test('CRCaseReview: layout includes a cr-remediation-section', async () => {
  const client = makeStubClient({ getRow: caseUntouched });
  const saveQueue = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = caseUntouched.id;
  await el.connectedCallback();

  // children: header(0), statusEl(1), section(2), remediationSection(3), outcomeEl(4), conversationEl(5), notesEl(6), completeBtn(7)
  const remediationSection = (/** @type {any} */ (el))._children[3];
  assert.ok(remediationSection, 'remediation section should exist');
  // The stub's update method should have been called with catalogue + answers
  assert.ok(remediationSection._updateArgs, 'update() should have been called on remediation section');
});

test('CRCaseReview: layout includes a cr-conversation element with case messages', async () => {
  const client = makeStubClient({ getRow: cases[1] }); // case-2 has 2 conversation messages
  const saveQueue = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = cases[1].id;
  await el.connectedCallback();

  // children: header(0), statusEl(1), section(2), remediationSection(3), outcomeEl(4), conversationEl(5), notesEl(6), completeBtn(7)
  const conversationEl = (/** @type {any} */ (el))._children[5];
  assert.ok(conversationEl, 'conversation element should exist');
  assert.ok(Array.isArray(conversationEl._messages), '_messages should be set');
  assert.equal(conversationEl._messages.length, 2);
});

test('CRCaseReview: layout includes a cr-notes element with case notes value', async () => {
  const client = makeStubClient({ getRow: cases[2] }); // case-3 has a non-empty notes value
  const saveQueue = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = cases[2].id;
  await el.connectedCallback();

  // children: header(0), statusEl(1), section(2), remediationSection(3), outcomeEl(4), conversationEl(5), notesEl(6), completeBtn(7)
  const notesEl = (/** @type {any} */ (el))._children[6];
  assert.ok(notesEl, 'notes element should exist');
  assert.equal(notesEl.notes, cases[2].notes);
  assert.equal(notesEl.caseId, cases[2].id);
});

test('CRCaseReview: layout includes a cr-outcome element updated with computeOutcome', async () => {
  const client = makeStubClient({ getRow: caseUntouched });
  const saveQueue = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = caseUntouched.id;
  await el.connectedCallback();

  // children: header(0), statusEl(1), section(2), remediationSection(3), outcomeEl(4), conversationEl(5), notesEl(6), completeBtn(7)
  const outcomeEl = (/** @type {any} */ (el))._children[4];
  assert.ok(outcomeEl, 'outcome element should exist');
  assert.ok(outcomeEl._updateArgs, 'update() should have been called on outcome element');
  // case-1 has no answers so allAnswered is false
  assert.equal(outcomeEl._updateArgs.a3, false, 'allAnswered should be false for untouched case');
  assert.equal(typeof outcomeEl._updateArgs.a1, 'function', 'computeOutcome should be a function');
});

test('CRCaseReview: outcome element receives allAnswered=true when all applicable questions answered', async () => {
  const client = makeStubClient({ getRow: caseCompletable });
  const saveQueue = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = caseCompletable.id;
  await el.connectedCallback();

  // case-3 has all applicable questions answered (q-welcome + q-needs + q-channel + q-products)
  const outcomeEl = (/** @type {any} */ (el))._children[4];
  assert.equal(outcomeEl._updateArgs.a3, true, 'allAnswered should be true for completable case');
});

test('CRCaseReview: _completeCase navigates to #/dashboard on success', async () => {
  const client = makeStubClient();
  const saveQueue = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });
  saveQueue.loadCase(caseCompletable);

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = caseCompletable.id;

  (/** @type {any} */ (globalThis)).location.hash = '';
  await el._completeCase(caseCompletable.id);

  assert.equal((/** @type {any} */ (globalThis)).location.hash, '#/dashboard');
});
