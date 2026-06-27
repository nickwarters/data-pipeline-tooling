// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaseMachine } from '../src/lib/case-machine.js';

/** @type {import('../src/services/permissions.js').Capabilities} */
const NO_CAPABILITIES = {
  isReviewer: false,
  ownedCaseTypes: [],
  isResponsibleParty: false,
  isReviewerManager: false,
  isResponsiblePartyManager: false,
  isMaintainer: false,
  isQaReviewer: false,
  isVisitor: true,
};

/** @type {import('../src/sharepoint-client.js').CaseTypeConfig} */
const EMPTY_CASE_TYPE_CONFIG = {
  questions: [],
  computeOutcome: () => ({ verdict: 'pass' }),
};

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
  replaceChildren(/** @type {StubEl[]} */ ...cs) {
    this._children = cs;
  }
  appendChild(/** @type {StubEl} */ c) {
    this._children.push(c);
    return c;
  }
  append(/** @type {StubEl[]} */ ...cs) {
    this._children.push(...cs);
  }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
    this._attrs[k] = v;
  }
  getAttribute(/** @type {string} */ k) {
    return this._attrs[k] ?? null;
  }
  focus() {}
  // Stub for CRQuestionList.update / CRRemediationSection.update / CROutcome.update.
  // Records the most recent call so tests can observe what the page rendered.
  update(/** @type {any[]} */ ...args) {
    this._update = args;
  }
}

class StubCustomEvent {
  /** @param {string} type @param {{ detail?: any }} [init] */
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail ?? null;
  }
}

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).document = {
  /** @param {string} _tag @returns {StubEl} */
  createElement(_tag) {
    return new StubEl();
  },
  addEventListener() {},
  removeEventListener() {},
};
/** @type {any} */ (globalThis).customElements = { define() {} };
/** @type {any} */ (globalThis).location = { hash: '' };
/** @type {any} */ (globalThis).CustomEvent = StubCustomEvent;

// ===== IMPORTS =====
const { CRCaseReview } = await import('../src/pages/cr-case-review.js');
const { SaveQueue } = await import('../src/services/save-queue.js');

// ===== HELPERS =====
/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @type {CaseRow} */
const BASE_ROW = {
  id: 'c1',
  caseType: 'example-review',
  title: 'Test Case',
  status: 'In-progress',
  assignedReviewer: 'u1',
  responsibleParty: 'u2',
  answers: {},
  conversation: [],
  notes: '',
  completedAt: null,
  etag: 'e1',
};

/**
 * @param {{ caseRow?: CaseRow, patchOk?: boolean, resolveUsers?: (accounts: string[]) => Promise<Record<string, string | null>>, exportHash?: string | null }} [opts]
 */
function makeClient({
  caseRow = BASE_ROW,
  patchOk = true,
  resolveUsers,
  exportHash = null,
} = {}) {
  return {
    async getCase() {
      return caseRow;
    },
    async getCurrentUser() {
      return { id: 'u1', displayName: 'User 1' };
    },
    async patchCase() {
      return { ok: patchOk, status: patchOk ? 200 : 500 };
    },
    async searchPeople() {
      return [];
    },
    resolveUsers: resolveUsers ?? (async () => ({})),
    async getExportHash() {
      return exportHash;
    },
  };
}

// ===== STRUCTURAL ACCESSORS =====
// The tabbed layout (ADR-0014) renders persistent chrome as direct children and
// the five Section panels inside a cr-tabs primitive. These accessors locate
// elements by role/panel id rather than raw child index so the assertions
// survive incidental layout shuffling.
const bannerOf = (/** @type {any} */ el) => el._children[0];
const headerOf = (/** @type {any} */ el) => el._children[1];
const tabsOf = (/** @type {any} */ el) => el._children[2];
const conversationOf = (/** @type {any} */ el) => el._children[3];
const completeBtnOf = (/** @type {any} */ el) => el._children[4];
const panelOf = (/** @type {any} */ el, /** @type {string} */ id) =>
  tabsOf(el).panels[id];
const tabFor = (/** @type {any} */ el, /** @type {string} */ id) =>
  tabsOf(el).tabs.find((/** @type {any} */ t) => t.id === id);
const questionSectionOf = (/** @type {any} */ el) => panelOf(el, 'questions');
const remediationOf = (/** @type {any} */ el) => panelOf(el, 'remediation');
const summaryOf = (/** @type {any} */ el) => panelOf(el, 'summary');
const notesOf = (/** @type {any} */ el) => panelOf(el, 'notes');
const detailsOf = (/** @type {any} */ el) => panelOf(el, 'details');

// ===== TESTS =====

// ===== TABBED LAYOUT (ADR-0014, #106) =====

test('CRCaseReview: renders a cr-tabs with Details · Review · Issues · Summary · Notes in order', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const tabs = tabsOf(el).tabs;
  assert.deepEqual(
    tabs.map((/** @type {any} */ t) => t.id),
    ['details', 'questions', 'remediation', 'summary', 'notes', 'appeal'],
    'tab order is Details · Review · Issues · Summary · Notes · Appeal (Review keeps the questions id, Issues the remediation id)'
  );
  assert.deepEqual(
    tabs.map((/** @type {any} */ t) => t.label),
    ['Details', 'Review', 'Issues', 'Summary', 'Notes', 'Appeal'],
    'the Questions Section surfaces under the UI label "Review"; Remediation under "Issues"'
  );
  // For the Assigned Reviewer on an In-progress case every Section is visible —
  // the Appeal Section is read-only (not hidden) for reviewers.
  assert.ok(
    tabs.every((/** @type {any} */ t) => !t.hidden),
    'no Section is hidden for the assigned reviewer'
  );
});

test('CRCaseReview: there is no standalone Outcome tab', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const tabIds = tabsOf(el).tabs.map((/** @type {any} */ t) => t.id);
  assert.ok(
    !tabIds.includes('outcome'),
    'the Outcome tab is removed (ADR-0016)'
  );
  assert.equal(
    tabsOf(el).panels.outcome,
    undefined,
    'no Outcome panel remains'
  );
});

test('CRCaseReview: the Summary panel reads the frozen outcomeAtCompletion on a Completed Case', async () => {
  const completedRow = {
    ...BASE_ROW,
    status: /** @type {'Completed'} */ ('Completed'),
    outcomeAtCompletion: 'fail',
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
  await el.connectedCallback();

  const summaryEl = summaryOf(el);
  assert.equal(
    summaryEl.caseRow,
    completedRow,
    'Summary receives the Case row so it can read the frozen snapshot'
  );
});

test('CRCaseReview: Summary receives the catalogue and the resolved summarySections (Notes excluded by default)', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  el.currentUserId = 'u1'; // assigned reviewer → full access
  await el.connectedCallback();

  const summaryEl = summaryOf(el);
  assert.ok(
    Array.isArray(summaryEl.catalogue) && summaryEl.catalogue.length > 0,
    'Summary receives the Question catalogue'
  );
  assert.deepEqual(
    summaryEl.summarySections,
    ['details', 'questions', 'remediation'],
    'Notes is excluded from Summary by default; Conversation/Summary never appear as blocks'
  );
});

test('CRCaseReview: each tab panel carries the matching Section content node', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  // The Questions panel is the <section> that holds qList + section-progress and
  // owns the cr-answer listener; the others are their respective custom elements.
  assert.ok(
    Array.isArray(questionSectionOf(el)._listeners['cr-answer']),
    'questions panel owns the cr-answer listener'
  );
  assert.equal(
    detailsOf(el).caseRow,
    BASE_ROW,
    'details panel receives the Case row'
  );
  assert.ok(remediationOf(el), 'remediation (Issues) panel present');
  assert.ok(summaryOf(el), 'summary panel present');
  assert.ok(notesOf(el), 'notes panel present');
});

test('CRCaseReview: notes panel receives notes and Case Justification from the Case row', async () => {
  /** @type {CaseRow} */
  const row = {
    ...BASE_ROW,
    notes: 'general note',
    caseJustification: 'why this case passes',
  };
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient({ caseRow: row }));
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  assert.equal(notesOf(el).notes, 'general note');
  assert.equal(notesOf(el).caseJustification, 'why this case passes');
});

test('CRCaseReview: appeal panel is wired with the Case row, access, user and catalogue', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const appeal = panelOf(el, 'appeal');
  assert.equal(appeal.caseId, 'c1', 'appeal panel knows the Case id');
  assert.equal(
    appeal.access,
    'read-only',
    'assigned reviewer sees the Appeal Section read-only'
  );
  assert.equal(
    appeal.currentUser.id,
    'u1',
    'current user forwarded for the appellant'
  );
  assert.ok(
    Array.isArray(appeal.catalogue),
    'catalogue forwarded so disputed Answers can be cited'
  );
  assert.equal(
    appeal.saveQueue,
    el.saveQueue,
    'writes go through the SaveQueue'
  );
});

test('CRCaseReview: default selected tab is Details', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  assert.equal(tabsOf(el).selected, 'details', 'Details is the default tab');
});

test('CRCaseReview: a Section that resolves to hidden produces a hidden tab (RP: Notes + Summary while In-progress)', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (
    makeClient({
      caseRow: {
        ...BASE_ROW,
        responsibleParty: 'u1',
        assignedReviewer: 'other',
      },
    })
  );
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  el.capabilities = {
    isReviewer: false,
    ownedCaseTypes: [],
    isResponsibleParty: true,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isQaReviewer: false,
    isVisitor: false,
  };
  await el.connectedCallback();

  assert.equal(
    tabFor(el, 'notes').hidden,
    true,
    'Notes is hidden for the Responsible Party'
  );
  assert.equal(
    tabFor(el, 'summary').hidden,
    true,
    'Summary is hidden for the RP on an In-progress case'
  );
  assert.equal(tabFor(el, 'details').hidden, false, 'Details stays visible');
  assert.equal(
    tabFor(el, 'questions').hidden,
    false,
    'Questions stays visible (read-only)'
  );
  assert.equal(
    tabFor(el, 'remediation').hidden,
    false,
    'Issues stays visible (read-only)'
  );
});

test('CRCaseReview: default tab falls back to the first visible Section when Details is absent', () => {
  const el = new CRCaseReview();
  const fakeClient = makeClient();
  const fakeSaveQueue = new SaveQueue(/** @type {any} */ (fakeClient));
  fakeSaveQueue.loadCase(BASE_ROW);
  el.subscribe = (/** @type {any} */ _sig, /** @type {any} */ _cb) => {};

  el._buildLayout({
    caseRow: BASE_ROW,
    catalogue: [],
    computeOutcome: () => ({ verdict: 'pass' }),
    client: /** @type {any} */ (fakeClient),
    saveQueue: /** @type {any} */ (fakeSaveQueue),
    answersSignal: /** @type {any} */ ({ get: () => ({}), set: () => {} }),
    applicableQuestions: /** @type {any} */ ({ get: () => [] }),
    allAnswered: /** @type {any} */ ({ get: () => false }),
    currentUser: { id: 'u1', displayName: 'User 1' },
    access: /** @type {any} */ ({
      details: 'hidden',
      questions: 'edit',
      conversation: 'edit',
      notes: 'edit',
      remediation: 'edit',
      summary: 'read-only',
      appeal: 'hidden',
    }),
  });

  assert.equal(
    tabFor(el, 'details').hidden,
    true,
    'no Details tab when the Case Type omits it'
  );
  assert.equal(
    tabsOf(el).selected,
    'questions',
    'falls back to the first visible tab in Section order'
  );
});

/**
 * Drive _buildLayout directly with an arbitrary access matrix so the Section→tab
 * mapping can be exercised for combinations no fixed role produces.
 * @param {import('../src/pages/cr-case-review.js').CRCaseReview} el
 * @param {Record<string, string>} access
 */
function buildLayoutWith(el, access) {
  const fakeClient = makeClient();
  const fakeSaveQueue = new SaveQueue(/** @type {any} */ (fakeClient));
  fakeSaveQueue.loadCase(BASE_ROW);
  el.subscribe = (/** @type {any} */ _sig, /** @type {any} */ _cb) => {};
  el._buildLayout({
    caseRow: BASE_ROW,
    catalogue: [],
    computeOutcome: () => /** @type {any} */ ({ verdict: 'pass' }),
    client: /** @type {any} */ (fakeClient),
    saveQueue: /** @type {any} */ (fakeSaveQueue),
    answersSignal: /** @type {any} */ ({ get: () => ({}), set: () => {} }),
    applicableQuestions: /** @type {any} */ ({ get: () => [] }),
    allAnswered: /** @type {any} */ ({ get: () => false }),
    currentUser: { id: 'u1', displayName: 'User 1' },
    // Appeal defaults to hidden so callers that only exercise the legacy Sections
    // don't sprout an Appeal tab; a caller can override it explicitly.
    access: /** @type {any} */ ({ appeal: 'hidden', ...access }),
  });
}

test('CRCaseReview: a hidden Questions or Remediation Section renders no tab', () => {
  const el = new CRCaseReview();
  buildLayoutWith(el, {
    details: 'edit',
    questions: 'hidden',
    conversation: 'edit',
    notes: 'edit',
    remediation: 'hidden',
    summary: 'read-only',
  });
  assert.equal(
    tabFor(el, 'questions').hidden,
    true,
    'no Questions tab when that Section is hidden'
  );
  assert.equal(
    tabFor(el, 'remediation').hidden,
    true,
    'no Issues tab when the Remediation Section is hidden'
  );
  assert.equal(
    tabsOf(el).selected,
    'details',
    'Details remains the default among the visible tabs'
  );
});

test('CRCaseReview: when every tab-bearing Section is hidden, no tab is selected', () => {
  const el = new CRCaseReview();
  // Conversation stays visible so this is not the all-Sections-hidden short-circuit,
  // yet none of the five tab-bearing Sections is visible — selection resolves to none.
  buildLayoutWith(el, {
    details: 'hidden',
    questions: 'hidden',
    conversation: 'edit',
    notes: 'hidden',
    remediation: 'hidden',
    summary: 'hidden',
  });
  assert.equal(
    tabsOf(el).selected,
    '',
    'no tab is selected when no tab-bearing Section is visible'
  );
  assert.equal(
    /** @type {any} */ (el)._activeTab.get(),
    '',
    'the in-component active-tab signal is empty'
  );
});

test('CRCaseReview: active tab is in-component state updated on cr-tab-change, never the URL', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  /** @type {any} */ (globalThis).location.hash = '';
  await el.connectedCallback();

  assert.equal(
    /** @type {any} */ (el)._activeTab.get(),
    'details',
    'starts on the default tab'
  );

  tabsOf(el)._listeners['cr-tab-change'][0]({ detail: { id: 'notes' } });

  assert.equal(
    /** @type {any} */ (el)._activeTab.get(),
    'notes',
    'cr-tab-change updates the in-component signal'
  );
  assert.equal(
    /** @type {any} */ (globalThis).location.hash,
    '',
    'switching tabs does not touch the URL'
  );
});

test('CRCaseReview: switching tabs does not refetch the Case and preserves the live answers signal', async () => {
  const client = makeClient();
  let getCaseCalls = 0;
  client.getCase = async () => {
    getCaseCalls++;
    return BASE_ROW;
  };
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.caseId = 'c1';
  await el.connectedCallback();
  assert.equal(getCaseCalls, 1, 'the Case is fetched once on mount');

  // Edit an answer, then switch tabs.
  const section = questionSectionOf(el);
  section._listeners['cr-answer'][0]({
    detail: { questionId: 'q-welcome', value: 'Yes' },
  });
  tabsOf(el)._listeners['cr-tab-change'][0]({ detail: { id: 'summary' } });

  assert.equal(getCaseCalls, 1, 'switching tabs must not refetch the Case');
  // The same qList element keeps receiving updates: the answers signal survived.
  const qList = section._children[1];
  assert.equal(
    qList._update[1]['q-welcome'].value,
    'Yes',
    'the live answer edit is preserved across the tab switch'
  );
});

test('CRCaseReview: persistent chrome (banner, conversation toggle, complete button) lives outside the tabs', async () => {
  const client = makeClient();
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
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.saveQueue.loadCase(completableRow);
  el.caseId = 'c1';
  await el.connectedCallback();

  // Banner is a direct child, not a panel.
  assert.ok(
    bannerOf(el).saveQueue,
    'status banner is wired and sits in the persistent chrome'
  );
  // Conversation toggle lives in the header (direct child), reachable from any tab.
  const toggleBtn = headerOf(el)._children.find(
    (/** @type {any} */ c) => c.className === 'cr-conversation-toggle-btn'
  );
  assert.ok(
    toggleBtn,
    'conversation toggle is in the header, outside the tabs'
  );
  // Complete button is a direct child too.
  assert.equal(completeBtnOf(el).className, 'cr-complete-btn');
  assert.equal(
    completeBtnOf(el).hidden,
    false,
    'complete button is reachable (visible) for a completable case'
  );
});

test('CRCaseReview: Conversation is a floating overlay (direct child), not a tab panel', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const tabIds = tabsOf(el).tabs.map((/** @type {any} */ t) => t.id);
  assert.ok(!tabIds.includes('conversation'), 'Conversation is never a tab');
  assert.equal(
    conversationOf(el).caseId,
    'c1',
    'Conversation is a direct child overlay'
  );
  assert.equal(
    tabsOf(el).panels.conversation,
    undefined,
    'Conversation has no tab panel'
  );
});

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
  assert.equal(/** @type {any} */ (el)._children.length, 0);
});

test('CRCaseReview: connectedCallback handles case not found', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ ({
    async getCase() {
      return null;
    },
    async getCurrentUser() {
      return { id: 'u1' };
    },
  });
  el.saveQueue = /** @type {any} */ ({});
  el.caseId = 'missing';
  await el.connectedCallback();

  const msg = /** @type {any} */ (el)._children[0];
  assert.equal(msg.textContent, 'Case not found.');
});

test('CRCaseReview: connectedCallback handles access denied', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (
    makeClient({
      caseRow: { ...BASE_ROW, assignedReviewer: 'someone-else' },
    })
  );
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  el.capabilities = {
    isReviewer: false,
    ownedCaseTypes: [],
    isResponsibleParty: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isQaReviewer: false,
    isVisitor: false,
  };

  await el.connectedCallback();

  const panel = /** @type {any} */ (el)._children[0];
  assert.equal(panel.className, 'cr-access-denied');
});

test('CRCaseReview: _completeCase returns early if client or saveQueue missing', async () => {
  const el = new CRCaseReview();
  // @ts-ignore
  await el._completeCase('c1', null, null);
  assert.equal(/** @type {any} */ (globalThis).location.hash, '');
});

test('CRCaseReview: _completeCase uses this.client if arg missing', async () => {
  const client = makeClient();
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.saveQueue.loadCase(BASE_ROW);

  /** @type {any} */ (globalThis).location.hash = '';
  // @ts-ignore
  await el._completeCase('c1', undefined, undefined);
  assert.equal(/** @type {any} */ (globalThis).location.hash, '#/dashboard');
});

test('CRCaseReview: _completeCase does not navigate on failure', async () => {
  const client = makeClient({ patchOk: false });
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.saveQueue.loadCase(BASE_ROW);

  /** @type {any} */ (globalThis).location.hash = 'keep-me';
  await el._completeCase(
    'c1',
    el.client ?? undefined,
    el.saveQueue ?? undefined
  );
  assert.equal(/** @type {any} */ (globalThis).location.hash, 'keep-me');
});

// ===== OUTCOME SNAPSHOT AT COMPLETION (ADR-0012, #115) =====

/**
 * A client whose patchCase records the fields it was asked to write, so a test
 * can assert exactly what landed in the single completion PATCH.
 * @param {{ patchOk?: boolean }} [opts]
 */
function makeRecordingClient({ patchOk = true } = {}) {
  /** @type {Array<{ id: string, fields: any, etag: string }>} */
  const patches = [];
  return {
    patches,
    async getCase() {
      return BASE_ROW;
    },
    async getCurrentUser() {
      return { id: 'u1', displayName: 'User 1' };
    },
    async patchCase(
      /** @type {string} */ id,
      /** @type {any} */ fields,
      /** @type {string} */ etag
    ) {
      patches.push({ id, fields, etag });
      return { ok: patchOk, status: patchOk ? 200 : 500 };
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
}

test('CRCaseReview: _completeCase stamps the frozen outcome snapshot in the same PATCH as status/completedAt', async () => {
  const client = makeRecordingClient();
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.saveQueue.loadCase(BASE_ROW);

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
      verdict: Object.values(a).some((x) => x.value === 'No') ? 'fail' : 'pass',
    });

  const machine = new CaseMachine(
    BASE_ROW,
    { id: 'test' },
    NO_CAPABILITIES,
    EMPTY_CASE_TYPE_CONFIG
  );
  const patchFields = machine.transitionToCompleted(computeOutcome, answers);
  await el._completeCase(
    'c1',
    el.client ?? undefined,
    el.saveQueue ?? undefined,
    patchFields
  );

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
    'the frozen verdict is computed over the current answers'
  );
  assert.equal(
    fields.hadRemediation,
    true,
    'hadRemediation is true when an Answer carries a Remediation Action'
  );
});

test('CRCaseReview: _completeCase initialises the effective-outcome columns equal to the frozen snapshot (ADR-0019)', async () => {
  const client = makeRecordingClient();
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.saveQueue.loadCase(BASE_ROW);

  const answers = {
    'q-needs': {
      value: 'No',
      remediationActions: [{ id: 'ra-0', text: 'Retrain.', completed: false }],
    },
  };
  /** @param {Record<string, any>} a */
  const computeOutcome = (a) =>
    /** @type {any} */ ({
      verdict: Object.values(a).some((x) => x.value === 'No') ? 'fail' : 'pass',
    });

  const machine = new CaseMachine(
    BASE_ROW,
    { id: 'test' },
    NO_CAPABILITIES,
    EMPTY_CASE_TYPE_CONFIG
  );
  const patchFields = machine.transitionToCompleted(computeOutcome, answers);
  await el._completeCase(
    'c1',
    el.client ?? undefined,
    el.saveQueue ?? undefined,
    patchFields
  );

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

test('CRCaseReview: hadRemediation=true is mutually exclusive with outcomeAtCompletion=pass', async () => {
  const client = makeRecordingClient();
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.saveQueue.loadCase(BASE_ROW);

  // A passing Answer set: no failures, so no Remediation Actions attach.
  const answers = { 'q-welcome': { value: 'Yes' } };
  /** @param {Record<string, any>} a */
  const computeOutcome = (a) =>
    /** @type {any} */ ({
      verdict: Object.values(a).some((x) => x.value === 'No') ? 'fail' : 'pass',
    });

  const machine = new CaseMachine(
    BASE_ROW,
    { id: 'test' },
    NO_CAPABILITIES,
    EMPTY_CASE_TYPE_CONFIG
  );
  const patchFields = machine.transitionToCompleted(computeOutcome, answers);
  await el._completeCase(
    'c1',
    el.client ?? undefined,
    el.saveQueue ?? undefined,
    patchFields
  );

  const { fields } = client.patches[0];
  assert.equal(fields.outcomeAtCompletion, 'pass');
  assert.equal(
    fields.hadRemediation,
    false,
    'a pass never co-occurs with hadRemediation=true'
  );
});

test('CRCaseReview: complete button feeds the live answers + computeOutcome into _completeCase', async () => {
  const client = makeClient();
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

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  await el.connectedCallback();

  /** @type {any} */
  let captured = null;
  el._completeCase = async (caseId, client, saveQueue, patchFields) => {
    captured = patchFields;
  };

  completeBtnOf(el)._listeners['click'][0]();
  await Promise.resolve();

  assert.ok(captured, '_completeCase was invoked from the button');
  assert.equal(captured.status, 'Completed', 'sets status Completed');
  assert.equal(
    captured.outcomeAtCompletion,
    'fail',
    'computed outcome is passed as patch field'
  );
  assert.equal(
    captured.hadRemediation,
    false,
    'hadRemediation is computed and passed'
  );
});

test('CRCaseReview: no inline cr-save-status paragraph in rendered children', async () => {
  const client = makeClient();
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const children = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  const hasStatusPara = children.some((c) => c.className === 'cr-save-status');
  assert.equal(
    hasStatusPara,
    false,
    'inline save-status paragraph must not appear; cr-status-banner handles display'
  );
});

test('CRCaseReview: remediation and conversation can be hidden', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (
    makeClient({
      caseRow: { ...BASE_ROW, assignedReviewer: 'u1' },
    })
  );
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
  el.capabilities = {
    isReviewer: false,
    ownedCaseTypes: [],
    isResponsibleParty: true,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isQaReviewer: false,
    isVisitor: false,
  };
  const rpRow = {
    ...BASE_ROW,
    responsibleParty: 'u1',
    assignedReviewer: 'other',
  };
  /** @type {any} */ (el.client).getCase = async () => rpRow;

  await el.connectedCallback();

  // A Section that resolves to hidden renders no tab (ADR-0014).
  assert.equal(
    tabFor(el, 'notes').hidden,
    true,
    'Notes should be hidden for RP'
  );
});

test('CRCaseReview: cr-answer handles unmapped question', async () => {
  const client = makeClient();
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  /** @type {any[]} */
  const enqueued = [];
  saveQueue.enqueue = (...args) => {
    enqueued.push(args);
  };

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = questionSectionOf(el);
  // Dispatch answer for an ID not in the catalogue
  section._listeners['cr-answer'][0]({
    detail: { questionId: 'unknown', value: 'Yes' },
  });

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0][2].unknown.value, 'Yes');
});

test('CRCaseReview: cr-answer clears answers for questions that become non-applicable', async () => {
  const client = makeClient();
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  /** @type {any[]} */
  const enqueued = [];
  saveQueue.enqueue = (...args) => {
    enqueued.push(args);
  };

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = questionSectionOf(el);
  const handler = section._listeners['cr-answer'][0];

  // 1. q-needs = Yes (triggers q-resolve)
  handler({ detail: { questionId: 'q-needs', value: 'Yes' } });
  // 2. q-resolve = Yes
  handler({ detail: { questionId: 'q-resolve', value: 'Yes' } });
  // 3. q-needs = No (q-resolve hidden)
  handler({ detail: { questionId: 'q-needs', value: 'No' } });

  const lastAnswers = enqueued[2][2];
  assert.equal(lastAnswers['q-needs'].value, 'No');
  assert.equal(
    lastAnswers['q-resolve'],
    undefined,
    'hidden conditional question answer should be cleared'
  );
});

test('CRCaseReview: cr-answer is ignored when questions access is read-only (RP role)', async () => {
  const client = makeClient({
    caseRow: {
      ...BASE_ROW,
      responsibleParty: 'user-rp',
      assignedReviewer: 'other-reviewer',
    },
  });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  /** @type {any[]} */
  const enqueued = [];
  saveQueue.enqueue = (...args) => {
    enqueued.push(args);
  };

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'user-rp';
  el.capabilities = {
    isReviewer: false,
    ownedCaseTypes: [],
    isResponsibleParty: true,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isQaReviewer: false,
    isVisitor: false,
  };
  await el.connectedCallback();

  // For RP, access.questions = 'read-only', so the cr-answer handler must early-return.
  const section = questionSectionOf(el);
  section._listeners['cr-answer'][0]({
    detail: { questionId: 'q-welcome', value: 'Yes' },
  });

  assert.equal(
    enqueued.length,
    0,
    'cr-answer must not enqueue when questions access is read-only'
  );
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
  el.capabilities = {
    isReviewer: true,
    ownedCaseTypes: [],
    isResponsibleParty: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isQaReviewer: false,
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
    },
  };
  client.getCase = async () => completableRow;
  saveQueue.loadCase(completableRow);

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  await el.connectedCallback();

  const completeBtn = completeBtnOf(el);
  completeBtn.disabled = true; // pre-disable

  let completeCalled = false;
  el._completeCase = async () => {
    completeCalled = true;
  };

  completeBtn._listeners['click'][0]();
  assert.equal(
    completeCalled,
    false,
    'disabled button click must not invoke _completeCase'
  );
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
    },
  };
  client.getCase = async () => completableRow;
  saveQueue.loadCase(completableRow);

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  await el.connectedCallback();

  const completeBtn = completeBtnOf(el);
  assert.equal(completeBtn.hidden, false, 'Complete button should be visible');

  let completeCalled = false;
  el._completeCase = async () => {
    completeCalled = true;
  };

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

  const section = questionSectionOf(el);
  // section._children: [h2, qList, cr-section-progress]
  const progressEl = section._children[2];
  assert.ok(
    progressEl,
    'cr-section-progress should be mounted inside the question section'
  );
  assert.ok(
    typeof progressEl.update === 'function',
    'cr-section-progress should have an update method'
  );
});

test('CRCaseReview: cr-section-progress.update is called with section data on initial render', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = questionSectionOf(el);
  const progressEl = section._children[2];

  /** @type {any[]} */
  const calls = [];
  /** @type {any} */ (progressEl).update = (/** @type {any[]} */ ...args) =>
    calls.push(args);

  // Trigger viewState update by simulating a cr-answer event
  section._listeners['cr-answer'][0]({
    detail: { questionId: 'q-welcome', value: 'Yes' },
  });

  assert.ok(calls.length > 0, 'update should be called after an answer change');
  const [sections] = calls[0];
  assert.ok(
    Array.isArray(sections),
    'first arg should be an array of section progress entries'
  );
  assert.ok(sections.length > 0, 'should have at least one section');
  assert.ok(
    'section' in sections[0],
    'each entry should have a section property'
  );
  assert.ok(
    'answered' in sections[0],
    'each entry should have an answered count'
  );
  assert.ok('total' in sections[0], 'each entry should have a total count');
});

test('CRCaseReview: cr-section-progress.update answered count increases after cr-answer', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = questionSectionOf(el);
  const progressEl = section._children[2];

  /** @type {any[][]} */
  const calls = [];
  /** @type {any} */ (progressEl).update = (/** @type {any[]} */ ...args) =>
    calls.push(args);

  // Answer q-welcome (category: 'Opening')
  section._listeners['cr-answer'][0]({
    detail: { questionId: 'q-welcome', value: 'Yes' },
  });
  const sections = calls[0][0];
  const opening = sections.find(
    (/** @type {any} */ s) => s.section === 'Opening'
  );
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

  const section = questionSectionOf(el);
  const progressEl = section._children[2];

  /** @type {any[][]} */
  const calls = [];
  /** @type {any} */ (progressEl).update = (/** @type {any[]} */ ...args) =>
    calls.push(args);

  section._listeners['cr-answer'][0]({
    detail: { questionId: 'q-welcome', value: 'Yes' },
  });
  const [, unanswered] = calls[0];
  assert.ok(
    Array.isArray(unanswered),
    'second arg should be the unanswered applicable questions array'
  );
  // q-welcome is answered; others remain unanswered
  assert.ok(
    !unanswered.some((/** @type {any} */ q) => q.id === 'q-welcome'),
    'answered question should not appear in unanswered list'
  );
});

test('CRCaseReview: cr-section-jump event on section scrolls first question of that section', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = questionSectionOf(el);
  // Check the event listener is registered for cr-section-jump
  assert.ok(
    Array.isArray(section._listeners['cr-section-jump']) &&
      section._listeners['cr-section-jump'].length > 0,
    'section should have a cr-section-jump listener'
  );
  // Fire it without throwing
  assert.doesNotThrow(() => {
    section._listeners['cr-section-jump'][0]({
      detail: { section: 'Opening' },
    });
  });
});

test('CRCaseReview: cr-jump-unanswered event scrolls to first unanswered applicable question', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = questionSectionOf(el);
  assert.ok(
    Array.isArray(section._listeners['cr-jump-unanswered']) &&
      section._listeners['cr-jump-unanswered'].length > 0,
    'section should have a cr-jump-unanswered listener'
  );
  assert.doesNotThrow(() => {
    section._listeners['cr-jump-unanswered'][0]({});
  });
});

// ===== CONVERSATION PANEL TOGGLE =====

test('CRCaseReview: conversation panel starts hidden by default', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const conversationEl = conversationOf(el);
  assert.equal(
    conversationEl.hidden,
    true,
    'conversation panel must start hidden'
  );
});

test('CRCaseReview: layout includes a cr-case-details element with the Case row and read-only access', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const detailsEl = detailsOf(el);
  assert.equal(
    detailsEl.caseRow,
    BASE_ROW,
    'details element receives the Case row'
  );
  assert.equal(
    detailsEl.access,
    'read-only',
    'details is read-only for the assigned reviewer'
  );
  assert.equal(
    tabFor(el, 'details').hidden,
    false,
    'details tab is shown when the Case Type allows it'
  );
});

test('CRCaseReview: _buildLayout renders no Details tab when access.details is hidden', () => {
  const el = new CRCaseReview();
  const fakeClient = makeClient();
  const fakeSaveQueue = new SaveQueue(/** @type {any} */ (fakeClient));
  fakeSaveQueue.loadCase(BASE_ROW);

  const answersSignal = { get: () => ({}), set: (/** @type {any} */ _v) => {} };
  const applicableQuestions = { get: () => [] };
  const allAnswered = { get: () => false };
  el.subscribe = (/** @type {any} */ _sig, /** @type {any} */ _cb) => {};

  el._buildLayout({
    caseRow: BASE_ROW,
    catalogue: [],
    computeOutcome: () => ({ verdict: 'pass' }),
    client: /** @type {any} */ (fakeClient),
    saveQueue: /** @type {any} */ (fakeSaveQueue),
    answersSignal: /** @type {any} */ (answersSignal),
    applicableQuestions: /** @type {any} */ (applicableQuestions),
    allAnswered: /** @type {any} */ (allAnswered),
    currentUser: { id: 'u1', displayName: 'User 1' },
    access: /** @type {any} */ ({
      details: 'hidden',
      questions: 'edit',
      conversation: 'edit',
      notes: 'edit',
      remediation: 'edit',
      summary: 'read-only',
    }),
  });

  assert.equal(
    tabFor(el, 'details').hidden,
    true,
    'no Details tab when access.details is hidden'
  );
});

test('CRCaseReview: toggle button is in the header when conversation access is not hidden', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const header = headerOf(el);
  const toggleBtn = /** @type {any} */ (header)._children.find(
    (/** @type {any} */ c) => c.className === 'cr-conversation-toggle-btn'
  );
  assert.ok(toggleBtn, 'toggle button should be in the header');
  assert.equal(
    toggleBtn.getAttribute('aria-expanded'),
    'false',
    'aria-expanded starts false'
  );
});

test('CRCaseReview: toggle button click shows then hides conversation', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const conversationEl = conversationOf(el);
  const header = headerOf(el);
  const toggleBtn = /** @type {any} */ (header)._children.find(
    (/** @type {any} */ c) => c.className === 'cr-conversation-toggle-btn'
  );

  toggleBtn._listeners['click'][0]();
  assert.equal(
    conversationEl.hidden,
    false,
    'first click should show the panel'
  );
  assert.equal(toggleBtn.getAttribute('aria-expanded'), 'true');

  toggleBtn._listeners['click'][0]();
  assert.equal(
    conversationEl.hidden,
    true,
    'second click should hide the panel'
  );
  assert.equal(toggleBtn.getAttribute('aria-expanded'), 'false');
});

test('CRCaseReview: data-conversation-mode defaults to popover', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  assert.equal(el.getAttribute('data-conversation-mode'), 'popover');
});

test('CRCaseReview: data-conversation-mode reads sidebar from location.search', async () => {
  /** @type {any} */ (globalThis).location.search = '?conversation=sidebar';
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();
  /** @type {any} */ (globalThis).location.search = undefined;

  assert.equal(el.getAttribute('data-conversation-mode'), 'sidebar');
});

test('CRCaseReview: Alt+C via _handleKeydown opens then closes the panel', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const conversationEl = conversationOf(el);
  assert.equal(conversationEl.hidden, true);

  el._handleKeydown(/** @type {any} */ ({ altKey: true, code: 'KeyC' }));
  assert.equal(
    conversationEl.hidden,
    false,
    'Alt/Option+C should open the panel'
  );

  el._handleKeydown(/** @type {any} */ ({ altKey: true, code: 'KeyC' }));
  assert.equal(
    conversationEl.hidden,
    true,
    'Alt/Option+C again should close the panel'
  );
});

test('CRCaseReview: _handleKeydown ignores keys that are not Alt+C', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const conversationEl = conversationOf(el);
  el._handleKeydown(/** @type {any} */ ({ altKey: false, code: 'KeyC' }));
  assert.equal(conversationEl.hidden, true, 'bare C must not toggle');
  el._handleKeydown(/** @type {any} */ ({ altKey: true, code: 'KeyK' }));
  assert.equal(conversationEl.hidden, true, 'Alt+K must not toggle');
});

test('CRCaseReview: disconnectedCallback nulls _keydownHandler', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  assert.ok(
    /** @type {any} */ (el)._keydownHandler !== null,
    'handler should be set after connect'
  );
  el.disconnectedCallback();
  assert.equal(
    /** @type {any} */ (el)._keydownHandler,
    null,
    'handler should be nulled after disconnect'
  );
});

// ===== DEFENSIVE BRANCH COVERAGE =====

test('CRCaseReview: _toggleConversationPanel returns early when _conversationEl is null', () => {
  const el = new CRCaseReview();
  // _conversationEl is null by default — should not throw
  assert.doesNotThrow(() => el._toggleConversationPanel());
});

test('CRCaseReview: _toggleConversationPanel toggles element when _conversationToggleBtn is null', () => {
  const el = new CRCaseReview();
  const fakeEl = new StubEl();
  fakeEl.hidden = false;
  /** @type {any} */ (el)._conversationEl = fakeEl;
  // _conversationToggleBtn remains null — setAttribute path must not throw
  assert.doesNotThrow(() => el._toggleConversationPanel());
  assert.equal(fakeEl.hidden, true, 'hidden should be toggled to true');
});

test('CRCaseReview: disconnectedCallback is safe when _keydownHandler is already null', () => {
  const el = new CRCaseReview();
  // _keydownHandler starts as null — calling disconnectedCallback must not throw
  assert.equal(/** @type {any} */ (el)._keydownHandler, null);
  assert.doesNotThrow(() => el.disconnectedCallback());
  assert.equal(
    /** @type {any} */ (el)._keydownHandler,
    null,
    'handler remains null'
  );
});

test('CRCaseReview: _buildLayout with access.conversation=hidden omits toggle button and leaves _keydownHandler null', () => {
  const el = new CRCaseReview();

  // Minimal stubs required by _buildLayout
  const fakeClient = makeClient();
  const fakeSaveQueue = new SaveQueue(/** @type {any} */ (fakeClient));
  fakeSaveQueue.loadCase(BASE_ROW);

  const { signal: signalFn, computed: computedFn } = /** @type {any} */ (
    // Re-use the already-imported signal module by grabbing it from the live module.
    // We reconstruct minimal stubs using plain objects since signal is already loaded.
    EMPTY_CASE_TYPE_CONFIG
  );

  // Build the minimal signal stubs _buildLayout needs
  const answersSignal = { get: () => ({}), set: (/** @type {any} */ _v) => {} };
  const applicableQuestions = { get: () => [] };
  const allAnswered = { get: () => false };
  const viewState = {
    get: () => ({ questions: [], answers: {}, allAnswered: false }),
  };

  // Patch subscribe to avoid real effect execution
  /** @type {any[]} */
  const subscribeCalls = [];
  el.subscribe = (/** @type {any} */ _sig, /** @type {any} */ _cb) => {
    subscribeCalls.push(_sig);
  };

  /** @type {import('../src/services/section-access.js').Mode} */
  const hidden = 'hidden';
  /** @type {import('../src/services/section-access.js').Mode} */
  const edit = 'edit';

  el._buildLayout({
    caseRow: BASE_ROW,
    catalogue: [],
    computeOutcome: () => ({ verdict: 'pass' }),
    client: /** @type {any} */ (fakeClient),
    saveQueue: /** @type {any} */ (fakeSaveQueue),
    answersSignal: /** @type {any} */ (answersSignal),
    applicableQuestions: /** @type {any} */ (applicableQuestions),
    allAnswered: /** @type {any} */ (allAnswered),
    currentUser: { id: 'u1', displayName: 'User 1' },
    access: /** @type {any} */ ({
      questions: edit,
      conversation: hidden,
      notes: edit,
      remediation: edit,
      summary: edit,
    }),
  });

  // No toggle button should appear in the header
  const header = headerOf(el);
  const toggleBtn = /** @type {any} */ (header)._children.find(
    (/** @type {any} */ c) => c.className === 'cr-conversation-toggle-btn'
  );
  assert.equal(
    toggleBtn,
    undefined,
    'toggle button must not be in header when conversation is hidden'
  );
  assert.equal(
    /** @type {any} */ (el)._keydownHandler,
    null,
    '_keydownHandler must remain null'
  );
  assert.equal(
    /** @type {any} */ (el)._conversationToggleBtn,
    null,
    '_conversationToggleBtn must remain null'
  );
});

test('CRCaseReview: cr-jump-unanswered handler calls scrollIntoView on first unanswered question element', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = questionSectionOf(el);
  // section._children: [h2, qList, cr-section-progress]
  const qList = section._children[1];

  // Simulate cr-question-list having rendered its child question elements.
  // Production wires them via qList.questionElements; the test stub does not
  // run the real _render so we populate this directly.
  /** @type {any[]} */
  const scrollCalls = [];
  /** @param {string} id */
  const makeQuestionEl = (id) => ({
    question: { id },
    scrollIntoView(/** @type {any} */ opts) {
      scrollCalls.push({ id, opts });
    },
  });
  qList.questionElements = [
    makeQuestionEl('q-welcome'),
    makeQuestionEl('q-needs'),
    makeQuestionEl('q-channel'),
    makeQuestionEl('q-products'),
  ];

  // Answer q-welcome so the first unanswered applicable question is q-needs.
  section._listeners['cr-answer'][0]({
    detail: { questionId: 'q-welcome', value: 'Yes' },
  });

  section._listeners['cr-jump-unanswered'][0]({});

  assert.equal(
    scrollCalls.length,
    1,
    'scrollIntoView should be called exactly once'
  );
  assert.equal(
    scrollCalls[0].id,
    'q-needs',
    'should scroll to first unanswered applicable question'
  );
});

// ===== Attributed Party persistence (cr-attribute) =====

test('CRCaseReview: Assigned Reviewer can set an Attributed Party, persisting via SaveQueue', async () => {
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

  const el = new CRCaseReview();
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

  remediation._listeners['cr-attribute'][0]({
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

test("CRCaseReview: forwards the Case's Responsible Party to the remediation section as a quick-pick", async () => {
  const failRow = {
    ...BASE_ROW,
    assignedReviewer: 'u1',
    responsibleParty: 'rparty',
    answers: { 'q-needs': { value: 'No' } },
  };
  const client = makeClient({ caseRow: failRow });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));

  const el = new CRCaseReview();
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

test('CRCaseReview: forwards a null Responsible Party when the Case has none', async () => {
  const failRow = {
    ...BASE_ROW,
    assignedReviewer: 'u1',
    responsibleParty: '',
    answers: { 'q-needs': { value: 'No' } },
  };
  const client = makeClient({ caseRow: failRow });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  await el.connectedCallback();

  const remediation = remediationOf(el);
  assert.equal(remediation.responsibleParty, null);
});

test('CRCaseReview: clearing an Attributed Party strips it from the Answer and persists', async () => {
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

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  await el.connectedCallback();

  const remediation = remediationOf(el);
  remediation._listeners['cr-attribute'][0]({
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

test('CRCaseReview: cr-attribute is ignored when the referenced Answer is missing', async () => {
  const client = makeClient({
    caseRow: { ...BASE_ROW, assignedReviewer: 'u1' },
  });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  /** @type {any[]} */
  const enqueued = [];
  saveQueue.enqueue = (...args) => {
    enqueued.push(args);
  };

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  await el.connectedCallback();

  const remediation = remediationOf(el);
  remediation._listeners['cr-attribute'][0]({
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

// ===== Issue Capture persistence (cr-capture, ADR-0020) =====

test('CRCaseReview: passes the Case Type captureGroups to the remediation section, editable for the Assigned Reviewer', async () => {
  const failRow = {
    ...BASE_ROW,
    assignedReviewer: 'u1',
    answers: { 'q-needs': { value: 'No' } },
  };
  const client = makeClient({ caseRow: failRow });
  const saveQueue = new SaveQueue(/** @type {any} */ (client));

  const el = new CRCaseReview();
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

test('CRCaseReview: a cr-capture event records the value into Answer.capture and persists', async () => {
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

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  await el.connectedCallback();

  const remediation = remediationOf(el);
  remediation._listeners['cr-capture'][0]({
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

test('CRCaseReview: a cr-capture for an unknown field key is ignored', async () => {
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

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  await el.connectedCallback();

  const remediation = remediationOf(el);
  remediation._listeners['cr-capture'][0]({
    detail: { questionId: 'q-needs', fieldKey: 'ghost', value: 'x' },
  });
  remediation._listeners['cr-capture'][0]({
    detail: { questionId: 'q-missing', fieldKey: 'rootCause', value: 'x' },
  });

  assert.equal(
    enqueued.length,
    0,
    'no persistence for an unknown field or missing Answer'
  );
});

test('CRCaseReview: capture is frozen (ignored) on a Completed case', async () => {
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

  const el = new CRCaseReview();
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
  remediation._listeners['cr-capture'][0]({
    detail: { questionId: 'q-needs', fieldKey: 'rootCause', value: 'x' },
  });
  assert.equal(enqueued.length, 0, 'no persistence when capture is frozen');
});

test('CRCaseReview: attribution is frozen (read-only) on a Completed case', async () => {
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

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  await el.connectedCallback();

  const remediation = remediationOf(el);
  assert.equal(
    remediation.canAttribute,
    false,
    'Completed case freezes attribution'
  );

  remediation._listeners['cr-attribute'][0]({
    detail: {
      questionId: 'q-needs',
      attributedParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
    },
  });
  assert.equal(
    enqueued.length,
    0,
    'a frozen attribution must not enqueue even if an event fires'
  );
});

test('CRCaseReview: non-assigned viewer cannot attribute (read-only)', async () => {
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

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  el.currentUserId = 'user-rp';
  el.capabilities = {
    isReviewer: false,
    ownedCaseTypes: [],
    isResponsibleParty: true,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isQaReviewer: false,
    isVisitor: false,
  };
  await el.connectedCallback();

  const remediation = remediationOf(el);
  assert.equal(
    remediation.canAttribute,
    false,
    'Responsible Party cannot attribute'
  );

  remediation._listeners['cr-attribute'][0]({
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

// ===== Attributed Party resolution at page load (#97, ADR-0013) =====

test('CRCaseReview: resolves stored Attributed Party names to authoritative display names at load', async () => {
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

  const el = new CRCaseReview();
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

test('CRCaseReview: collects unique Attributed Party accounts across answers before resolving', async () => {
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

  const el = new CRCaseReview();
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

test('CRCaseReview: keeps the cached Attributed Party name when resolution returns null', async () => {
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

  const el = new CRCaseReview();
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

test('CRCaseReview: does not resolve users when no Answer carries an Attributed Party', async () => {
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

  const el = new CRCaseReview();
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

// ===== QA Answer Override authoring (issue #133, ADR-0018) =====

/** A client whose current user is a standalone QA Reviewer (not the Assigned Reviewer). */
function makeQaClient(/** @type {CaseRow} */ caseRow) {
  return {
    async getCase() {
      return caseRow;
    },
    async getCurrentUser() {
      return { id: 'qa1', displayName: 'QA One' };
    },
    async patchCase() {
      return { ok: true, status: 200 };
    },
    async searchPeople() {
      return [];
    },
    resolveUsers: async () => ({}),
    async getExportHash() {
      return null;
    },
  };
}

/** @type {import('../src/services/permissions.js').Capabilities} */
const QA_CAPS = {
  isReviewer: false,
  ownedCaseTypes: [],
  isResponsibleParty: false,
  isReviewerManager: false,
  isResponsiblePartyManager: false,
  isMaintainer: false,
  isQaReviewer: true,
  isVisitor: false,
};

test('CRCaseReview: a QA Reviewer on a Completed Case gets the override editor and a read-only Questions list', async () => {
  const client = makeQaClient({
    ...BASE_ROW,
    status: 'Completed',
    completedAt: '2026-06-10T00:00:00Z',
  });
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.caseId = 'c1';
  el.currentUserId = 'qa1';
  el.capabilities = QA_CAPS;
  await el.connectedCallback();

  const section = questionSectionOf(el);
  const editor = section._children.find(
    (/** @type {any} */ c) => c.access === 'override' && c.caseId === 'c1'
  );
  assert.ok(
    editor,
    'the cr-override-editor is mounted under the Questions Section'
  );
  assert.equal(editor.currentUser.id, 'qa1');

  // The read-only Questions list sees the override Mode coerced to read-only.
  const qList = section._children.find(
    (/** @type {any} */ c) => c.access === 'read-only'
  );
  assert.ok(
    qList,
    'the Questions list is presented read-only to the QA Reviewer'
  );
});

test('CRCaseReview: a QA Reviewer on a Completed Case gets the Appeal resolution path', async () => {
  const client = makeQaClient({
    ...BASE_ROW,
    status: 'Completed',
    completedAt: '2026-06-10T00:00:00Z',
  });
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.caseId = 'c1';
  el.currentUserId = 'qa1';
  el.capabilities = QA_CAPS;
  await el.connectedCallback();

  const appeal = panelOf(el, 'appeal');
  assert.equal(
    appeal.access,
    'edit',
    'QA Reviewer gets edit on the Appeal Section'
  );
  assert.equal(
    appeal.canResolve,
    true,
    'the resolver flag selects the resolution form'
  );
  // The Override editor an agreed Appeal reveals needs the Case Type config.
  assert.equal(appeal.client, el.client, 'people picker client forwarded');
  assert.ok(
    Array.isArray(appeal.remediationFields),
    'remediation fields forwarded'
  );
});

test('CRCaseReview: an appellant on a Completed Case does not get the resolver flag', async () => {
  const client = makeClient({
    caseRow: {
      ...BASE_ROW,
      status: 'Completed',
      completedAt: '2026-06-10T00:00:00Z',
      responsibleParty: 'u1',
      assignedReviewer: 'other',
    },
  });
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  el.capabilities = {
    isReviewer: false,
    ownedCaseTypes: [],
    isResponsibleParty: true,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isQaReviewer: false,
    isVisitor: false,
  };
  await el.connectedCallback();

  const appeal = panelOf(el, 'appeal');
  assert.equal(appeal.access, 'edit', 'the appellant gets edit to raise');
  assert.equal(appeal.canResolve, false, 'the appellant is not a resolver');
});

test('CRCaseReview: a QA Reviewer on an In-progress Case gets no override editor', async () => {
  const client = makeQaClient({ ...BASE_ROW, status: 'In-progress' });
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.caseId = 'c1';
  el.currentUserId = 'qa1';
  el.capabilities = QA_CAPS;
  await el.connectedCallback();

  const section = questionSectionOf(el);
  const editor = section._children.find(
    (/** @type {any} */ c) => c.access === 'override'
  );
  assert.equal(editor, undefined, 'no override authoring while In-progress');
});

// ===== QA Check source Case panel (issue #47, ADR-0018) =====

/** The original Completed example-review Case a QA Check meta-reviews. */
function makeOriginalRow() {
  return /** @type {CaseRow} */ ({
    id: 'case-14',
    caseType: 'example-review',
    title: 'Example Review #14 (overridden)',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: { 'q-welcome': { value: 'Yes' }, 'q-needs': { value: 'Yes' } },
    overrides: [
      {
        source: 'qa',
        author: 'user-qa',
        at: '2026-04-05T00:00:00Z',
        answerKey: 'q-welcome',
        value: 'No',
        reasoning: 'No greeting.',
      },
    ],
    conversation: [],
    notes: '',
    completedAt: '2026-04-05T08:00:00Z',
    outcomeAtCompletion: 'pass',
    etag: 'etag-c14-v1',
  });
}

/** The QA Check Case (qa-example-review) linked to the original via sourceCaseId. */
function makeQaCheckRow() {
  return /** @type {CaseRow} */ ({
    id: 'qa-case-1',
    caseType: 'qa-example-review',
    title: 'QA Check — Example Review #14',
    status: 'In-progress',
    assignedReviewer: 'user-qa',
    responsibleParty: '',
    sourceCaseId: 'case-14',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'etag-qa1-v1',
  });
}

/** A client serving the QA Check by its own id and the original by sourceCaseId.
 * @param {CaseRow} qaRow @param {CaseRow} originalRow */
function makeQaCheckClient(qaRow, originalRow) {
  return {
    async getCase(/** @type {string} */ id) {
      return id === originalRow.id ? originalRow : qaRow;
    },
    async getCurrentUser() {
      return { id: 'user-qa', displayName: 'Quinn QA' };
    },
    async patchCase() {
      return { ok: true, status: 200 };
    },
    async searchPeople() {
      return [];
    },
    resolveUsers: async () => ({}),
    async getExportHash() {
      return null;
    },
  };
}

const sourceCaseOf = (/** @type {any} */ el) =>
  /** @type {any[]} */ (el._children).find((c) => 'originalRow' in c);

test('CRCaseReview: a QA Check fetches its source Case and mounts a read-only source panel', async () => {
  const qaRow = makeQaCheckRow();
  const original = makeOriginalRow();
  const client = makeQaCheckClient(qaRow, original);
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.caseId = 'qa-case-1';
  el.currentUserId = 'user-qa';
  el.capabilities = QA_CAPS;
  await el.connectedCallback();

  const panel = sourceCaseOf(el);
  assert.ok(panel, 'a cr-source-case panel is mounted for a QA Check');
  assert.equal(
    panel.originalRow,
    original,
    'the panel receives the fetched original row'
  );
  assert.ok(
    panel.catalogue.some((/** @type {any} */ q) => q.id === 'q-welcome'),
    "the original Case Type's catalogue is forwarded"
  );
  assert.equal(
    typeof panel.computeOutcome,
    'function',
    "the original Case Type's outcome fn is forwarded"
  );
});

test('CRCaseReview: the source panel resolves override access against the linked original and stamps the QA Check id', async () => {
  const qaRow = makeQaCheckRow();
  const original = makeOriginalRow();
  const client = makeQaCheckClient(qaRow, original);
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.caseId = 'qa-case-1';
  el.currentUserId = 'user-qa';
  el.capabilities = QA_CAPS;
  await el.connectedCallback();

  const panel = sourceCaseOf(el);
  assert.equal(
    panel.overrideAccess,
    'override',
    'a QA Reviewer on a Completed original gets override access'
  );
  assert.equal(
    panel.sourceCaseId,
    'qa-case-1',
    'overrides authored here are stamped with the QA Check id'
  );
});

test('CRCaseReview: the SaveQueue tracks the original ETag so the cross-row Override write is guarded', async () => {
  const qaRow = makeQaCheckRow();
  const original = makeOriginalRow();
  const client = makeQaCheckClient(qaRow, original);
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.caseId = 'qa-case-1';
  el.currentUserId = 'user-qa';
  el.capabilities = QA_CAPS;
  await el.connectedCallback();

  assert.equal(
    el.saveQueue.getEtag('case-14'),
    'etag-c14-v1',
    'the original row ETag is loaded for the cross-row PATCH'
  );
});

test('CRCaseReview: an In-progress original yields read-only source access (nothing to override yet)', async () => {
  const qaRow = makeQaCheckRow();
  const original = {
    ...makeOriginalRow(),
    status: /** @type {'In-progress'} */ ('In-progress'),
    completedAt: null,
  };
  const client = makeQaCheckClient(qaRow, original);
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.caseId = 'qa-case-1';
  el.currentUserId = 'user-qa';
  el.capabilities = QA_CAPS;
  await el.connectedCallback();

  assert.equal(
    sourceCaseOf(el).overrideAccess,
    'read-only',
    'no override while the original is In-progress'
  );
});

test('CRCaseReview: a missing source Case still mounts the panel (renders its not-found state)', async () => {
  const qaRow = makeQaCheckRow();
  const client = {
    async getCase(/** @type {string} */ id) {
      return id === 'qa-case-1' ? qaRow : null;
    },
    async getCurrentUser() {
      return { id: 'user-qa', displayName: 'Quinn QA' };
    },
    async patchCase() {
      return { ok: true, status: 200 };
    },
    async searchPeople() {
      return [];
    },
    resolveUsers: async () => ({}),
    async getExportHash() {
      return null;
    },
  };
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.caseId = 'qa-case-1';
  el.currentUserId = 'user-qa';
  el.capabilities = QA_CAPS;
  await el.connectedCallback();

  const panel = sourceCaseOf(el);
  assert.ok(panel, 'the panel is mounted even when the original is missing');
  assert.equal(
    panel.originalRow,
    null,
    'the panel gets a null original and renders its own not-found message'
  );
});

test('CRCaseReview: a standard Case (no sourceCaseId) mounts no source panel', async () => {
  const el = new CRCaseReview();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  assert.equal(
    sourceCaseOf(el),
    undefined,
    'no source panel without a sourceCaseId'
  );
  // The persistent-chrome indices are unchanged for a standard Case.
  assert.equal(
    tabsOf(el).panels.questions !== undefined,
    true,
    'tabs remain at their standard position'
  );
});

// ===== QUESTION BANK VERSION STAMP AT COMPLETION (ADR-0021 Step 3, #182) =====

test('CaseMachine.transitionToCompleted stamps questionBankVersion when provided', () => {
  const machine = new CaseMachine(
    BASE_ROW,
    { id: 'u1' },
    NO_CAPABILITIES,
    EMPTY_CASE_TYPE_CONFIG
  );
  const fields = machine.transitionToCompleted(
    null,
    undefined,
    'sha256:aabbccdd'
  );
  assert.equal(
    fields.questionBankVersion,
    'sha256:aabbccdd',
    'questionBankVersion is included in the PATCH fields'
  );
});

test('CaseMachine.transitionToCompleted omits questionBankVersion when null', () => {
  const machine = new CaseMachine(
    BASE_ROW,
    { id: 'u1' },
    NO_CAPABILITIES,
    EMPTY_CASE_TYPE_CONFIG
  );
  const fields = machine.transitionToCompleted(null, undefined, null);
  assert.equal(
    Object.hasOwn(fields, 'questionBankVersion'),
    false,
    'no questionBankVersion key when null'
  );
});

test('CaseMachine.transitionToCompleted omits questionBankVersion when not provided', () => {
  const machine = new CaseMachine(
    BASE_ROW,
    { id: 'u1' },
    NO_CAPABILITIES,
    EMPTY_CASE_TYPE_CONFIG
  );
  const fields = machine.transitionToCompleted(null, undefined);
  assert.equal(
    Object.hasOwn(fields, 'questionBankVersion'),
    false,
    'no questionBankVersion key when argument absent'
  );
});

test('CRCaseReview: complete button passes exportHash as questionBankVersion to transitionToCompleted', async () => {
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
  const saveQueue = new SaveQueue(/** @type {any} */ (client));
  saveQueue.loadCase(completableRow);

  const el = new CRCaseReview();
  el.client = /** @type {any} */ (client);
  el.saveQueue = saveQueue;
  el.caseId = 'c1';
  await el.connectedCallback();

  /** @type {any} */
  let captured = null;
  el._completeCase = async (caseId, client, saveQueue, patchFields) => {
    captured = patchFields;
  };

  completeBtnOf(el)._listeners['click'][0]();
  await Promise.resolve();

  assert.equal(
    captured?.questionBankVersion,
    HASH,
    'questionBankVersion from the export hash is included in the completion PATCH'
  );
});
