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
  // Stub for CRQuestionList.update — prevents crash when subscribe fires.
  update(/** @type {any} */ questions, /** @type {any} */ answers) {
    this._updateArgs = { questions, answers };
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
  const answers = { 'q-welcome': { value: 'Yes' }, 'q-needs': { value: 'No' } };
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

test('allApplicableAnswered: all three applicable questions answered → true', () => {
  const answers = {
    'q-welcome': { value: 'Yes' },
    'q-needs': { value: 'Yes' },
    'q-resolve': { value: 'Yes' },
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

  const completeBtn = (/** @type {any} */ (el))._children[3];
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

  const completeBtn = (/** @type {any} */ (el))._children[3];
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
