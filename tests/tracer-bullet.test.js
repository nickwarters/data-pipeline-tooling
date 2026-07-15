// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl, useElementClass } from './_dom-stub.js';

installDom();

class RecordingEl extends StubEl {
  constructor(tag = '') {
    super(tag);
    /** @type {any} */
    this._updateArgs = null;
  }
  // Stub for CORAQuestionList.update / CORARemediationSection.update /
  // CORASummary.update. Some `update()` callers (e.g. cora-summary, since
  // MAINT-07b) now pass a single props object; others still pass positional
  // args. Record either shape faithfully: a lone object arg is stored as-is
  // (so `.computeOutcome`/`.allAnswered` etc. read naturally), multiple/
  // positional args fall back to the old `.a1`/`.a2`/`.a3` shape.
  update(/** @type {any[]} */ ...args) {
    this._updateArgs =
      args.length === 1 && args[0] !== null && typeof args[0] === 'object'
        ? args[0]
        : { a1: args[0], a2: args[1], a3: args[2] };
  }
}

useElementClass(RecordingEl);

// Must be set before imports that create custom-element shell classes.

// ===== IMPORTS (after stubs are in place) =====
const { allApplicableAnswered } =
  await import('../src/evaluators/applicability-evaluator.js');
const { MockSharePointClient } =
  await import('../src/services/mock-sharepoint-client.js');
const { SaveQueue } = await import('../src/services/save-queue.js');
const { CaseReviewPage } = await import('../src/pages/cora-case-review.js');
const { completeCase } =
  await import('../src/pages/cora-case-review/completion-controller.js');

/** Settle the CaseReviewPage async load across a few macrotask turns. */
async function settle() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

/**
 * Thin test harness around the CaseReviewPage function component: keeps the
 * "set fields, then connect" ergonomics and proxies the reactive host so these
 * end-to-end assertions read against rendered output.
 */
class CaseReviewHarness {
  constructor() {
    /** @type {any} */
    this.client = null;
    /** @type {any} */
    this.saveQueue = null;
    this.caseId = '';
    /** @type {string | null} */
    this.caseType = null;
    this.currentUserId = '';
    /** @type {any} */
    this.capabilities = null;
    /** @type {any} */
    this._host = null;
  }

  async connectedCallback() {
    this._host = CaseReviewPage({
      client: this.client,
      saveQueue: this.saveQueue,
      caseId: this.caseId,
      caseType: this.caseType,
      currentUserId: this.currentUserId,
      capabilities: this.capabilities,
    });
    await settle();
  }

  get _children() {
    return this._host ? this._host._children : [];
  }
}
const { cases } = await import('../dev/fixtures/cases.js');
const { questionDefinitions } =
  await import('../dev/fixtures/question-definitions.js');
const { personas } = await import('../dev/fixtures/personas.js');

// ===== FIXTURES =====
/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

const caseUntouched = cases[0]; // case-1: no answers
const caseCompletable = cases[2]; // case-3: all applicable questions answered

/** @type {QuestionDefinition[]} */
const CATALOGUE = questionDefinitions; // q-welcome, q-needs, q-resolve(conditional)

// ===== TABBED-LAYOUT ACCESSORS (ADR-0014) =====
// Persistent chrome is rendered as direct children: banner(0), header(1),
// cora-tabs(2), conversation overlay(3), complete button(4). The five Section
// panels hang off cora-tabs via its `panels` map; locate them by id rather than
// by raw index.
const tabsOf = (/** @type {any} */ el) => el._children[2];
const conversationOf = (/** @type {any} */ el) => el._children[3];
const completeBtnOf = (/** @type {any} */ el) => el._children[4];
const panelOf = (/** @type {any} */ el, /** @type {string} */ id) =>
  tabsOf(el).panels[id];
const questionSectionOf = (/** @type {any} */ el) => panelOf(el, 'questions');
const remediationOf = (/** @type {any} */ el) => panelOf(el, 'remediation');
const summaryOf = (/** @type {any} */ el) => panelOf(el, 'summary');
const notesOf = (/** @type {any} */ el) => panelOf(el, 'notes');

// Minimal client stub for component tests
/**
 * @param {{ patchReturn?: import('../src/sharepoint-client.js').PatchResult, getRow?: CaseRow }} [opts]
 */
function makeStubClient({
  patchReturn = { ok: true, status: 200 },
  getRow = caseCompletable,
} = {}) {
  /** @type {{ id: string, fields: Partial<CaseRow>, etag: string }[]} */
  const patchCalls = [];
  return {
    patchCalls,
    async getCase(/** @type {string} */ _id) {
      return { ...getRow };
    },
    async patchCase(
      /** @type {string} */ id,
      /** @type {Partial<CaseRow>} */ fields,
      /** @type {string} */ etag
    ) {
      patchCalls.push({ id, fields, etag });
      return patchReturn;
    },
    async listCases(
      /** @type {import('../src/sharepoint-client.js').ListCasesFilter} */ filter
    ) {
      return cases.filter((c) => {
        if (filter.status !== undefined && c.status !== filter.status)
          return false;
        if (
          filter.assignedReviewer !== undefined &&
          c.assignedReviewer !== filter.assignedReviewer
        )
          return false;
        return true;
      });
    },
    async getQuestionDefinitions(/** @type {string[]} */ _ids) {
      return [];
    },
    async getCurrentUserGroups() {
      return [];
    },
    async resolveUsers(/** @type {string[]} */ _accounts) {
      return {};
    },
    async getCurrentUser() {
      return { id: 'user-reviewer', displayName: 'Alex Reviewer' };
    },
    async getExportHash() {
      return null;
    },
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

// ===== TESTS: CORACaseReview =====

test('CORACaseReview: connectedCallback calls getCase and saveQueue.loadCase', async () => {
  const getCalls = /** @type {string[]} */ ([]);
  const loadCalls = /** @type {CaseRow[]} */ ([]);

  const client = {
    async getCase(/** @type {string} */ id) {
      getCalls.push(id);
      return { ...caseCompletable };
    },
    async patchCase() {
      return { ok: true, status: 200 };
    },
    async listCases() {
      return [];
    },
    async getQuestionDefinitions() {
      return [];
    },
    async getCurrentUserGroups() {
      return [];
    },
    async resolveUsers() {
      return {};
    },
    async getCurrentUser() {
      return { id: 'user-reviewer', displayName: 'Alex' };
    },
    async getExportHash() {
      return null;
    },
  };

  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });
  const origLoad = saveQueue.loadCase.bind(saveQueue);
  saveQueue.loadCase = (/** @type {CaseRow} */ row) => {
    loadCalls.push(row);
    return origLoad(row);
  };

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = caseCompletable.id;

  await el.connectedCallback();

  assert.deepEqual(getCalls, [caseCompletable.id]);
  assert.equal(loadCalls.length, 1);
  assert.equal(loadCalls[0].id, caseCompletable.id);
});

test('CORACaseReview: complete button is hidden when not all applicable questions answered', async () => {
  const client = makeStubClient({ getRow: caseUntouched });
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = caseUntouched.id;

  await el.connectedCallback();

  const completeBtn = completeBtnOf(el);
  assert.equal(completeBtn.hidden, true);
});

test('CORACaseReview: complete button is visible when all applicable questions answered', async () => {
  const client = makeStubClient({ getRow: caseCompletable });
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = caseCompletable.id;

  await el.connectedCallback();

  const completeBtn = completeBtnOf(el);
  assert.equal(completeBtn.hidden, false);
});

test('completeCase: patches status:Completed with completedAt using stored ETag', async () => {
  const client = makeStubClient();
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });
  saveQueue.loadCase(caseCompletable);

  /** @type {any} */ (globalThis).location.hash = '';
  await completeCase({
    caseId: caseCompletable.id,
    client: /** @type {any} */ (client),
    saveQueue,
    patchFields: null,
    opts: {},
  });

  assert.equal(client.patchCalls.length, 1);
  assert.equal(client.patchCalls[0].id, caseCompletable.id);
  assert.equal(client.patchCalls[0].fields.status, 'Completed');
  assert.ok(
    typeof client.patchCalls[0].fields.completedAt === 'string',
    'completedAt should be an ISO string'
  );
  assert.equal(client.patchCalls[0].etag, caseCompletable.etag);
});

test('CORACaseReview: cora-answer with failing value does not auto-select remediationActions', async () => {
  const client = makeStubClient({ getRow: caseUntouched });
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });

  /** @type {{ id: string, fields: any }[]} */
  const enqueued = [];
  const origEnqueue = saveQueue.enqueue.bind(saveQueue);
  saveQueue.enqueue = (
    /** @type {string} */ id,
    /** @type {string} */ field,
    /** @type {unknown} */ val
  ) => {
    enqueued.push({ id, fields: { [field]: val } });
    return origEnqueue(id, field, val);
  };

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = caseUntouched.id;
  await el.connectedCallback();

  // Find the section element and dispatch a cora-answer for q-needs = No
  // (a failure with available, but not selected, remediationActions).
  const section = questionSectionOf(el);
  const handler = section._listeners['cora-answer'][0];
  handler({ detail: { questionId: 'q-needs', value: 'No' } });

  assert.equal(enqueued.length, 1);
  const saved = enqueued[0].fields.answers;
  assert.equal(saved['q-needs'].value, 'No');
  assert.equal(
    saved['q-needs'].remediationActions,
    undefined,
    'remediationActions should not be selected automatically'
  );
});

test('CORACaseReview: changing a failed Answer to a passing value strips remediationActions', async () => {
  const failed = /** @type {CaseRow} */ ({
    ...caseUntouched,
    answers: {
      'q-needs': {
        value: 'No',
        remediationActions: [
          { id: 'q-needs-ra-0', text: 'old', completed: false },
        ],
      },
    },
  });
  const client = makeStubClient({ getRow: failed });
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });

  /** @type {any[]} */
  const enqueued = [];
  const origEnqueue = saveQueue.enqueue.bind(saveQueue);
  saveQueue.enqueue = (
    /** @type {string} */ id,
    /** @type {string} */ f,
    /** @type {unknown} */ v
  ) => {
    enqueued.push({ id, field: f, value: v });
    return origEnqueue(id, f, v);
  };

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = failed.id;
  await el.connectedCallback();

  const section = questionSectionOf(el);
  section._listeners['cora-answer'][0]({
    detail: { questionId: 'q-needs', value: 'Yes' },
  });

  assert.equal(enqueued.length, 1);
  const saved = enqueued[0].value;
  assert.equal(saved['q-needs'].value, 'Yes');
  assert.equal(saved['q-needs'].remediationActions, undefined);
});

test('CORACaseReview: hiding a conditional question clears its previous Answer', async () => {
  const client = makeStubClient({ getRow: caseUntouched });
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });

  /** @type {any[]} */
  const enqueued = [];
  const origEnqueue = saveQueue.enqueue.bind(saveQueue);
  saveQueue.enqueue = (
    /** @type {string} */ id,
    /** @type {string} */ f,
    /** @type {unknown} */ v
  ) => {
    enqueued.push({ id, field: f, value: v });
    return origEnqueue(id, f, v);
  };

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = caseUntouched.id;
  await el.connectedCallback();

  const section = questionSectionOf(el);
  const handler = section._listeners['cora-answer'][0];

  // 1. q-needs = Yes → q-resolve becomes applicable
  handler({ detail: { questionId: 'q-needs', value: 'Yes' } });
  // 2. answer q-resolve = No
  handler({ detail: { questionId: 'q-resolve', value: 'No' } });
  // 3. q-needs = No → q-resolve hides; its answer must be cleared
  handler({ detail: { questionId: 'q-needs', value: 'No' } });

  const lastSaved = enqueued[enqueued.length - 1].value;
  assert.equal(lastSaved['q-needs'].value, 'No');
  assert.equal(
    lastSaved['q-resolve'],
    undefined,
    'q-resolve answer should be cleared when its trigger no longer makes it applicable'
  );
});

test('CORACaseReview: re-showing a conditional question after hide reveals it blank', async () => {
  const client = makeStubClient({ getRow: caseUntouched });
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });

  /** @type {any[]} */
  const enqueued = [];
  const origEnqueue = saveQueue.enqueue.bind(saveQueue);
  saveQueue.enqueue = (
    /** @type {string} */ id,
    /** @type {string} */ f,
    /** @type {unknown} */ v
  ) => {
    enqueued.push({ id, field: f, value: v });
    return origEnqueue(id, f, v);
  };

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = caseUntouched.id;
  await el.connectedCallback();

  const section = questionSectionOf(el);
  const handler = section._listeners['cora-answer'][0];

  handler({ detail: { questionId: 'q-needs', value: 'Yes' } });
  handler({ detail: { questionId: 'q-resolve', value: 'No' } });
  handler({ detail: { questionId: 'q-needs', value: 'No' } });
  handler({ detail: { questionId: 'q-needs', value: 'Yes' } });

  const lastSaved = enqueued[enqueued.length - 1].value;
  assert.equal(
    lastSaved['q-resolve'],
    undefined,
    'q-resolve should remain blank after re-appearing'
  );
});

test('CORACaseReview: layout includes a cora-remediation-section', async () => {
  const client = makeStubClient({ getRow: caseUntouched });
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = caseUntouched.id;
  await el.connectedCallback();

  const remediationSection = remediationOf(el);
  assert.ok(remediationSection, 'remediation section should exist');
  // The stub's update method should have been called with catalogue + answers
  assert.ok(
    remediationSection._updateArgs,
    'update() should have been called on remediation section'
  );
});

test('CORACaseReview: layout includes a cora-conversation element with case messages', async () => {
  const client = makeStubClient({ getRow: cases[1] }); // case-2 has 2 conversation messages
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = cases[1].id;
  await el.connectedCallback();

  const conversationEl = conversationOf(el);
  assert.ok(conversationEl, 'conversation element should exist');
  assert.ok(Array.isArray(conversationEl._messages), '_messages should be set');
  assert.equal(conversationEl._messages.length, 2);
});

test('CORACaseReview: layout includes a cora-notes element with case notes value', async () => {
  const client = makeStubClient({ getRow: cases[2] }); // case-3 has a non-empty notes value
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = cases[2].id;
  await el.connectedCallback();

  const notesEl = notesOf(el);
  assert.ok(notesEl, 'notes element should exist');
  // Notes renders from the Case row (the single source of truth, issue #317).
  assert.equal(notesEl.caseRow.notes, cases[2].notes);
  assert.equal(notesEl.caseId, cases[2].id);
});

test('CORACaseReview: Summary panel is updated with computeOutcome (Outcome block reused inside Summary)', async () => {
  const client = makeStubClient({ getRow: caseUntouched });
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = caseUntouched.id;
  await el.connectedCallback();

  const summaryEl = summaryOf(el);
  assert.ok(summaryEl, 'summary element should exist');
  assert.ok(
    summaryEl._updateArgs,
    'update() should have been called on the summary element'
  );
  // case-1 has no answers so allAnswered is false
  assert.equal(
    summaryEl._updateArgs.allAnswered,
    false,
    'allAnswered should be false for untouched case'
  );
  assert.equal(
    typeof summaryEl._updateArgs.computeOutcome,
    'function',
    'computeOutcome should be a function'
  );
});

test('CORACaseReview: Summary panel receives allAnswered=true when all applicable questions answered', async () => {
  const client = makeStubClient({ getRow: caseCompletable });
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });

  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = caseCompletable.id;
  await el.connectedCallback();

  // case-3 has all applicable questions answered (q-welcome + q-needs + q-channel + q-products)
  const summaryEl = summaryOf(el);
  assert.equal(
    summaryEl._updateArgs.allAnswered,
    true,
    'allAnswered should be true for completable case'
  );
});

test('completeCase: navigates to #/dashboard on success', async () => {
  const client = makeStubClient();
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });
  saveQueue.loadCase(caseCompletable);

  /** @type {any} */ (globalThis).location.hash = '';
  await completeCase({
    caseId: caseCompletable.id,
    client: /** @type {any} */ (client),
    saveQueue,
    patchFields: null,
    opts: {},
  });

  assert.equal(/** @type {any} */ (globalThis).location.hash, '#/dashboard');
});
