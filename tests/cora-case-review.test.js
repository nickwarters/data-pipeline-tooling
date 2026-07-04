// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl, useElementClass, flush } from './_dom-stub.js';

installDom();

// Stub for CORAQuestionList.update / CORARemediationSection.update / CORAOutcome.update.
// Records the most recent call so tests can observe what the page rendered.
class RecordingEl extends StubEl {
  constructor(tag = '') {
    super(tag);
    /** @type {any[] | undefined} */
    this._update = undefined;
  }
  update(/** @type {any[]} */ ...args) {
    this._update = args;
  }
}

useElementClass(RecordingEl);
import { CaseMachine, isReportable } from '../src/lib/case-machine.js';
import { addWorkingDays } from '../src/lib/add-working-days.js';
import {
  ENGLAND_WALES_HOLIDAYS,
  REMEDIATION_SLA_WORKING_DAYS,
} from '../src/config/working-days.js';

/** @type {import('../src/services/permissions.js').Capabilities} */
const NO_CAPABILITIES = {
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
const EMPTY_CASE_TYPE_CONFIG = {
  questions: [],
  computeOutcome: () => ({ outcome: 'pass' }),
};

// ===== IMPORTS =====
const { CaseReviewPage } = await import('../src/pages/cora-case-review.js');
const { SaveQueue } = await import('../src/services/save-queue.js');
const { completeCase } =
  await import('../src/pages/cora-case-review/completion-controller.js');

/**
 * Settle the CaseReviewPage async load: getCase/getCurrentUser, the dynamic
 * import() of the Case Type config, and the attributed-party resolution round
 * all resolve across a few macrotask turns.
 */
async function settle() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

/**
 * Thin test harness around the CaseReviewPage function component. The page is a
 * plain function returning a reactive() host; this adapter keeps the historic
 * "set fields, then connect" ergonomics (and proxies the observable host) so
 * the behaviour assertions below read against rendered output, not page
 * internals. `_children`, `getAttribute`, and `disconnectedCallback` are the
 * reactive host's own.
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

  /** @param {string} name */
  getAttribute(name) {
    return this._host ? this._host.getAttribute(name) : null;
  }

  disconnectedCallback() {
    this._host?.disconnectedCallback?.();
  }
}

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
// the five Section panels inside a cora-tabs primitive. These accessors locate
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
// The Issues capture tab keeps the `cora-remediation-section` node under the
// `issues` panel key after the ADR-0024 split; `remediation` is the new tracking
// tab (`cora-remediation-tracking`).
const remediationOf = (/** @type {any} */ el) => panelOf(el, 'issues');
const trackingOf = (/** @type {any} */ el) => panelOf(el, 'remediation');
const summaryOf = (/** @type {any} */ el) => panelOf(el, 'summary');
const notesOf = (/** @type {any} */ el) => panelOf(el, 'notes');
const detailsOf = (/** @type {any} */ el) => panelOf(el, 'details');

// ===== TESTS =====

// ===== TABBED LAYOUT (ADR-0014, #106) =====

test('CORACaseReview: renders a cora-tabs with Details · Review · Issues · Summary · Notes in order', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const tabs = tabsOf(el).tabs;
  assert.deepEqual(
    tabs.map((/** @type {any} */ t) => t.id),
    [
      'details',
      'questions',
      'issues',
      'remediation',
      'summary',
      'notes',
      'appealRequest',
      'appealReview',
      'amendOutcome',
    ],
    'tab order is Details · Review · Issues · Remediation · Summary · Notes · Appeal · Appeal Review · Amend Outcome'
  );
  assert.deepEqual(
    tabs.map((/** @type {any} */ t) => t.label),
    [
      'Details',
      'Review',
      'Issues',
      'Remediation',
      'Summary',
      'Notes',
      'Appeal',
      'Appeal Review',
      'Amend Outcome',
    ],
    'the Questions Section surfaces under "Review"; the capture tab under "Issues"; the tracking tab under "Remediation"'
  );
  // For the Assigned Reviewer on an In-progress case every Section is visible
  // except the Remediation *tracking* tab (hidden until actions sent, ADR-0024)
  // and Amend Outcome (Controls-only, ADR-0026).
  const hidden = tabs
    .filter((/** @type {any} */ t) => t.hidden)
    .map((/** @type {any} */ t) => t.id);
  assert.deepEqual(hidden, ['remediation', 'amendOutcome']);
});

test('CORACaseReview: there is no standalone Outcome tab', async () => {
  const el = new CaseReviewHarness();
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

test('CORACaseReview: the Summary panel reads the frozen outcomeAtCompletion on a Completed Case', async () => {
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

  const el = new CaseReviewHarness();
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

test('CORACaseReview: Summary receives the catalogue and the resolved summarySections (Notes excluded by default)', async () => {
  const el = new CaseReviewHarness();
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
    ['details', 'questions', 'issues'],
    'Notes excluded by default; the Remediation tracking block is dropped while its Section is hidden (no sent actions)'
  );
});

test('CORACaseReview: each tab panel carries the matching Section content node', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  // The Questions panel is the <section> that holds qList + section-progress and
  // owns the cora-answer listener; the others are their respective custom elements.
  assert.ok(
    Array.isArray(questionSectionOf(el)._listeners['cora-answer']),
    'questions panel owns the cora-answer listener'
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

test('CORACaseReview: notes panel receives notes and Case Justification from the Case row', async () => {
  /** @type {CaseRow} */
  const row = {
    ...BASE_ROW,
    notes: 'general note',
    caseJustification: 'why this case passes',
  };
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient({ caseRow: row }));
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  assert.equal(notesOf(el).notes, 'general note');
  assert.equal(notesOf(el).caseJustification, 'why this case passes');
});

test('CORACaseReview: appeal panel is wired with the Case row, access, user and catalogue', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const appeal = panelOf(el, 'appealRequest');
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

test('CORACaseReview: default selected tab is Details', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  assert.equal(tabsOf(el).selected, 'details', 'Details is the default tab');
});

test('CORACaseReview: the Adviser (Responsible Party) has no content tabs while In-progress (ADR-0011 amend)', async () => {
  const el = new CaseReviewHarness();
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

  // The Adviser reads only the Summary (once reportable) and posts in the
  // Conversation overlay. On an In-progress Case every tab resolves to hidden;
  // Details/Questions/Issues are folded into the Summary they will later read.
  for (const section of /** @type {const} */ ([
    'details',
    'questions',
    'issues',
    'remediation',
    'summary',
    'notes',
    'appealRequest',
  ])) {
    assert.equal(
      tabFor(el, section).hidden,
      true,
      `${section} tab is hidden for the Adviser while In-progress`
    );
  }
});

test('CORACaseReview: no tab is selected when every tab-bearing Section is hidden', async () => {
  // The Adviser (Responsible Party) on an In-progress Case sees no content tab —
  // only the Conversation overlay — so this is not the all-Sections-hidden
  // short-circuit, yet no tab-bearing Section is visible and selection resolves
  // to none. This exercises the view model's first-visible fallback observably.
  const el = new CaseReviewHarness();
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

  assert.equal(
    tabsOf(el).selected,
    '',
    'no tab is selected when no tab-bearing Section is visible'
  );
});

test('CORACaseReview: the selected tab updates on cora-tab-change, never the URL', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  /** @type {any} */ (globalThis).location.hash = '';
  await el.connectedCallback();

  assert.equal(tabsOf(el).selected, 'details', 'starts on the default tab');

  tabsOf(el)._listeners['cora-tab-change'][0]({ detail: { id: 'notes' } });

  assert.equal(
    tabsOf(el).selected,
    'notes',
    'cora-tab-change updates the selected tab'
  );
  assert.equal(
    /** @type {any} */ (globalThis).location.hash,
    '',
    'switching tabs does not touch the URL'
  );
});

test('CORACaseReview: switching tabs does not refetch the Case and preserves the live answers signal', async () => {
  const client = makeClient();
  let getCaseCalls = 0;
  client.getCase = async () => {
    getCaseCalls++;
    return BASE_ROW;
  };
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.caseId = 'c1';
  await el.connectedCallback();
  assert.equal(getCaseCalls, 1, 'the Case is fetched once on mount');

  // Edit an answer, then switch tabs.
  const section = questionSectionOf(el);
  section._listeners['cora-answer'][0]({
    detail: { questionId: 'q-welcome', value: 'Yes' },
  });
  tabsOf(el)._listeners['cora-tab-change'][0]({ detail: { id: 'summary' } });

  assert.equal(getCaseCalls, 1, 'switching tabs must not refetch the Case');
  // The same qList element keeps receiving updates: the answers signal survived.
  const qList = section._children[1];
  assert.equal(
    qList._update[1]['q-welcome'].value,
    'Yes',
    'the live answer edit is preserved across the tab switch'
  );
});

test('CORACaseReview: persistent chrome (banner, conversation toggle, complete button) lives outside the tabs', async () => {
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
  const el = new CaseReviewHarness();
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
    (/** @type {any} */ c) => c.className === 'cora-conversation-toggle-btn'
  );
  assert.ok(
    toggleBtn,
    'conversation toggle is in the header, outside the tabs'
  );
  // Complete button is a direct child too.
  assert.equal(completeBtnOf(el).className, 'cora-complete-btn');
  assert.equal(
    completeBtnOf(el).hidden,
    false,
    'complete button is reachable (visible) for a completable case'
  );
});

test('CORACaseReview: Conversation is a floating overlay (direct child), not a tab panel', async () => {
  const el = new CaseReviewHarness();
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

test('CORACaseReview: constructor initializes with nulls/empty', () => {
  const el = new CaseReviewHarness();
  assert.equal(el.client, null);
  assert.equal(el.saveQueue, null);
  assert.equal(el.caseId, '');
  assert.equal(el.currentUserId, '');
  assert.equal(el.capabilities, null);
});

test('CORACaseReview: connectedCallback returns early if missing deps', async () => {
  const el = new CaseReviewHarness();
  // No client, saveQueue, or caseId
  await el.connectedCallback();
  assert.equal(/** @type {any} */ (el)._children.length, 0);
});

test('CORACaseReview: connectedCallback handles case not found', async () => {
  const el = new CaseReviewHarness();
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

test('CORACaseReview: connectedCallback handles access denied', async () => {
  const el = new CaseReviewHarness();
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

  const panel = /** @type {any} */ (el)._children[0];
  assert.equal(panel.className, 'cora-access-denied');
});

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
    patchFields: null,
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
    patchFields: null,
    opts: {},
  });
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

  completeBtnOf(el)._listeners['click'][0]();
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

test('CORACaseReview: no inline cora-save-status paragraph in rendered children', async () => {
  const client = makeClient();
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const children = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  const hasStatusPara = children.some((c) => c.className === 'cora-save-status');
  assert.equal(
    hasStatusPara,
    false,
    'inline save-status paragraph must not appear; cora-status-banner handles display'
  );
});

test('CORACaseReview: remediation and conversation can be hidden', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (
    makeClient({
      caseRow: { ...BASE_ROW, assignedReviewer: 'u1' },
    })
  );
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  el.currentUserId = 'u1';
  // Drive a real Responsible Party (Adviser) role: the access matrix hides Notes
  // for the RP, so its tab resolves to hidden. This exercises the Section→tab
  // hidden mapping through user-observable access rather than a synthetic matrix.
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

test('CORACaseReview: cora-answer handles unmapped question', async () => {
  const client = makeClient();
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
  await el.connectedCallback();

  const section = questionSectionOf(el);
  // Dispatch answer for an ID not in the catalogue
  section._listeners['cora-answer'][0]({
    detail: { questionId: 'unknown', value: 'Yes' },
  });

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0][2].unknown.value, 'Yes');
});

test('CORACaseReview: cora-answer clears answers for questions that become non-applicable', async () => {
  const client = makeClient();
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
  await el.connectedCallback();

  const section = questionSectionOf(el);
  const handler = section._listeners['cora-answer'][0];

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

test('CORACaseReview: cora-answer is ignored when questions access is read-only (RP role)', async () => {
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

  // For RP, access.questions = 'read-only', so the cora-answer handler must early-return.
  const section = questionSectionOf(el);
  section._listeners['cora-answer'][0]({
    detail: { questionId: 'q-welcome', value: 'Yes' },
  });

  assert.equal(
    enqueued.length,
    0,
    'cora-answer must not enqueue when questions access is read-only'
  );
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

  completeBtn._listeners['click'][0]();
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

  completeBtn._listeners['click'][0]();
  await flush();
  assert.equal(
    patchCalled,
    true,
    'clicking the button drives a completion PATCH'
  );
});

// ===== SECTION PROGRESS INTEGRATION =====

test('CORACaseReview: cora-section-progress is mounted inside the question section', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = questionSectionOf(el);
  // section._children: [h2, qList, cora-section-progress]
  const progressEl = section._children[2];
  assert.ok(
    progressEl,
    'cora-section-progress should be mounted inside the question section'
  );
  assert.ok(
    typeof progressEl.update === 'function',
    'cora-section-progress should have an update method'
  );
});

test('CORACaseReview: cora-section-progress.update is called with section data on initial render', async () => {
  const el = new CaseReviewHarness();
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

  // Trigger viewState update by simulating a cora-answer event
  section._listeners['cora-answer'][0]({
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

test('CORACaseReview: cora-section-progress.update answered count increases after cora-answer', async () => {
  const el = new CaseReviewHarness();
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
  section._listeners['cora-answer'][0]({
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

test('CORACaseReview: cora-section-progress receives unanswered applicable questions list', async () => {
  const el = new CaseReviewHarness();
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

  section._listeners['cora-answer'][0]({
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

test('CORACaseReview: cora-section-jump event on section scrolls first question of that section', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = questionSectionOf(el);
  // Check the event listener is registered for cora-section-jump
  assert.ok(
    Array.isArray(section._listeners['cora-section-jump']) &&
      section._listeners['cora-section-jump'].length > 0,
    'section should have a cora-section-jump listener'
  );
  // Fire it without throwing
  assert.doesNotThrow(() => {
    section._listeners['cora-section-jump'][0]({
      detail: { section: 'Opening' },
    });
  });
});

test('CORACaseReview: cora-jump-unanswered event scrolls to first unanswered applicable question', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = questionSectionOf(el);
  assert.ok(
    Array.isArray(section._listeners['cora-jump-unanswered']) &&
      section._listeners['cora-jump-unanswered'].length > 0,
    'section should have a cora-jump-unanswered listener'
  );
  assert.doesNotThrow(() => {
    section._listeners['cora-jump-unanswered'][0]({});
  });
});

// ===== CONVERSATION PANEL TOGGLE =====

test('CORACaseReview: conversation panel starts hidden by default', async () => {
  const el = new CaseReviewHarness();
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

test('CORACaseReview: layout includes a cora-case-details element with the Case row and read-only access', async () => {
  const el = new CaseReviewHarness();
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

test('CORACaseReview: toggle button is in the header when conversation access is not hidden', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const header = headerOf(el);
  const toggleBtn = /** @type {any} */ (header)._children.find(
    (/** @type {any} */ c) => c.className === 'cora-conversation-toggle-btn'
  );
  assert.ok(toggleBtn, 'toggle button should be in the header');
  assert.equal(
    toggleBtn.getAttribute('aria-expanded'),
    'false',
    'aria-expanded starts false'
  );
});

test('CORACaseReview: toggle button click shows then hides conversation', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const conversationEl = conversationOf(el);
  const header = headerOf(el);
  const toggleBtn = /** @type {any} */ (header)._children.find(
    (/** @type {any} */ c) => c.className === 'cora-conversation-toggle-btn'
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

test('CORACaseReview: data-conversation-mode defaults to popover', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  assert.equal(el.getAttribute('data-conversation-mode'), 'popover');
});

test('CORACaseReview: data-conversation-mode reads sidebar from location.search', async () => {
  /** @type {any} */ (globalThis).location.search = '?conversation=sidebar';
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();
  /** @type {any} */ (globalThis).location.search = undefined;

  assert.equal(el.getAttribute('data-conversation-mode'), 'sidebar');
});

// The Alt+C shortcut is registered by the page shell through on(document,
// 'keydown', …); the binding's Alt+C/other-key handling in isolation is covered
// in tests/cora-case-review-controllers.test.js (createConversationPanelBinding).
test('CORACaseReview: an Alt+C keydown on the document toggles the conversation panel', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const conversationEl = conversationOf(el);
  assert.equal(conversationEl.hidden, true, 'conversation starts hidden');

  /** @type {any} */ (globalThis).document._fire('keydown', {
    altKey: true,
    code: 'KeyC',
  });

  assert.equal(
    conversationEl.hidden,
    false,
    'Alt+C on the document shows the panel via the page-registered listener'
  );
});

// The page shell tears its reactive view (and the on() document listener) down
// cleanly when it disconnects.
test('CORACaseReview: disconnectedCallback tears down the conversation binding without throwing', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  assert.doesNotThrow(() => el.disconnectedCallback());
});

test('CORACaseReview: cora-jump-unanswered handler calls scrollIntoView on first unanswered question element', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = questionSectionOf(el);
  // section._children: [h2, qList, cora-section-progress]
  const qList = section._children[1];

  // Simulate cora-question-list having rendered its child question elements.
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
  section._listeners['cora-answer'][0]({
    detail: { questionId: 'q-welcome', value: 'Yes' },
  });

  section._listeners['cora-jump-unanswered'][0]({});

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

// ===== Attributed Party persistence (cora-attribute) =====

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

  remediation._listeners['cora-attribute'][0]({
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

test('CORACaseReview: forwards a null Responsible Party when the Case has none', async () => {
  const failRow = {
    ...BASE_ROW,
    assignedReviewer: 'u1',
    responsibleParty: '',
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
  assert.equal(remediation.responsibleParty, null);
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
  remediation._listeners['cora-attribute'][0]({
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
  remediation._listeners['cora-attribute'][0]({
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

// ===== Issue Capture persistence (cora-capture, ADR-0020) =====

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
  remediation._listeners['cora-capture'][0]({
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
  remediation._listeners['cora-capture'][0]({
    detail: { questionId: 'q-needs', fieldKey: 'ghost', value: 'x' },
  });
  remediation._listeners['cora-capture'][0]({
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
  remediation._listeners['cora-capture'][0]({
    detail: { questionId: 'q-needs', fieldKey: 'rootCause', value: 'x' },
  });
  assert.equal(enqueued.length, 0, 'no persistence when capture is frozen');
});

test('CORACaseReview: attribution is frozen (read-only) on a Completed case', async () => {
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
    remediation.canAttribute,
    false,
    'Completed case freezes attribution'
  );

  remediation._listeners['cora-attribute'][0]({
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

  remediation._listeners['cora-attribute'][0]({
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

// ===== Lifecycle & the reportable milestone (ADR-0023) =====

test('isReportable: true from Actions In Progress and Completed, false while In-progress', () => {
  assert.equal(isReportable('In-progress'), false);
  assert.equal(isReportable('Actions In Progress'), true);
  assert.equal(isReportable('Completed'), true);
});

/** @type {import('../src/sharepoint-client.js').CaseTypeConfig} */
const ATTRIBUTE_CONFIG = {
  questions: [],
  computeOutcome: () => ({ outcome: 'pass' }),
  attributeFailures: true,
};

/**
 * @param {'In-progress'|'Actions In Progress'|'Completed'} status
 * @param {import('../src/sharepoint-client.js').CaseTypeConfig} [config]
 */
const machineForStatus = (status, config = EMPTY_CASE_TYPE_CONFIG) =>
  new CaseMachine(
    { ...BASE_ROW, status },
    { id: 'u1' },
    NO_CAPABILITIES,
    config
  );

test('CaseMachine.reportable mirrors the status milestone', () => {
  assert.equal(machineForStatus('In-progress').reportable, false);
  assert.equal(machineForStatus('Actions In Progress').reportable, true);
  assert.equal(machineForStatus('Completed').reportable, true);
});

test('CaseMachine.canComplete is gated on the reportable predicate, not a hard-coded status', () => {
  assert.equal(
    machineForStatus('In-progress').canComplete,
    true,
    'the assigned Reviewer can complete while the Case is still editable'
  );
  assert.equal(
    machineForStatus('Actions In Progress').canComplete,
    false,
    'a reportable Case is frozen — the Summary button no longer completes it'
  );
  assert.equal(machineForStatus('Completed').canComplete, false);
});

test('CaseMachine.canAttribute / canCapture are gated on the reportable predicate', () => {
  assert.equal(
    machineForStatus('In-progress', ATTRIBUTE_CONFIG).canAttribute,
    true
  );
  assert.equal(
    machineForStatus('In-progress', ATTRIBUTE_CONFIG).canCapture,
    true
  );
  assert.equal(
    machineForStatus('Actions In Progress', ATTRIBUTE_CONFIG).canAttribute,
    false,
    'attribution freezes at the reportable milestone (Send Actions)'
  );
  assert.equal(
    machineForStatus('Completed', ATTRIBUTE_CONFIG).canAttribute,
    false
  );
});

test('CaseMachine.canSelectRemediation follows Issues edit access, not attributeFailures (issue #250)', () => {
  // Unlike canAttribute/canCapture, action selection does not require the Case
  // Type to opt into attributeFailures — EMPTY_CASE_TYPE_CONFIG has none.
  assert.equal(
    machineForStatus('In-progress').canSelectRemediation,
    true,
    'the assigned Reviewer may select actions while the Case is editable'
  );
  assert.equal(
    machineForStatus('Actions In Progress').canSelectRemediation,
    false,
    'selection freezes at the reportable milestone'
  );
  assert.equal(machineForStatus('Completed').canSelectRemediation, false);
});

/** @type {import('../src/sharepoint-client.js').CaseTypeConfig} */
const ACTIONS_CONFIG = {
  questions: [],
  computeOutcome: () => ({ outcome: 'pass' }),
  captureGroups: [
    {
      key: 'g',
      label: 'G',
      fields: [{ key: 'acts', label: 'Acts', type: 'actions' }],
    },
  ],
};

test('CaseMachine.canCompleteRemediation gates the final close on the tracking tab (ADR-0024)', () => {
  const resolved = {
    'q-a': {
      value: 'No',
      capture: { acts: [{ id: 'a', text: 'x', status: 'complete' }] },
    },
  };
  const pending = {
    'q-a': {
      value: 'No',
      capture: { acts: [{ id: 'a', text: 'x', status: 'pending' }] },
    },
  };
  /**
   * @param {'In-progress'|'Actions In Progress'|'Completed'} status
   * @param {Record<string, any>} answers
   * @param {string} [reviewer]
   */
  const make = (status, answers, reviewer = 'u1') =>
    new CaseMachine(
      { ...BASE_ROW, status, assignedReviewer: reviewer, answers },
      { id: 'u1' },
      NO_CAPABILITIES,
      ACTIONS_CONFIG
    );

  assert.equal(
    make('Actions In Progress', resolved).canCompleteRemediation,
    true,
    'reviewer may close once every sent action is resolved'
  );
  assert.equal(
    make('Actions In Progress', pending).canCompleteRemediation,
    false,
    'blocked while an action is still pending'
  );
  assert.equal(
    make('In-progress', resolved).canCompleteRemediation,
    false,
    'inert before actions are sent (the tracking tab is not editable)'
  );
  assert.equal(
    make('Actions In Progress', resolved, 'other').canCompleteRemediation,
    false,
    'only the assigned reviewer closes it'
  );
});

test('CaseMachine.transitionToActionsInProgress stamps the reportable snapshot without completedAt (ADR-0023)', () => {
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

  const fields = machineForStatus('In-progress').transitionToActionsInProgress(
    computeOutcome,
    answers,
    'sha256:v1'
  );

  assert.equal(fields.status, 'Actions In Progress');
  assert.equal(typeof fields.reportableAt, 'string', 'reportableAt is stamped');
  // The remediation SLA due date is stamped here, once, as reportableAt + 10
  // working days (ADR-0025) — a plain YYYY-MM-DD ISO date on the Case row.
  assert.match(
    String(fields.remediationDueDate),
    /^\d{4}-\d{2}-\d{2}$/,
    'remediationDueDate is a YYYY-MM-DD ISO date'
  );
  assert.equal(
    fields.remediationDueDate,
    addWorkingDays(
      String(fields.reportableAt),
      REMEDIATION_SLA_WORKING_DAYS,
      ENGLAND_WALES_HOLIDAYS
    ),
    'remediationDueDate = reportableAt + 10 working days'
  );
  assert.equal(
    Object.hasOwn(fields, 'completedAt'),
    false,
    'completedAt is NOT stamped on the actions path — the Case is not yet closed'
  );
  assert.equal(
    fields.outcomeAtCompletion,
    'fail',
    'outcome snapshot at reportable'
  );
  assert.equal(fields.hadRemediation, true);
  assert.equal(fields.effectiveOutcome, 'fail');
  assert.equal(fields.effectiveHadRemediation, true);
  assert.equal(fields.outcomeOverridden, false);
  assert.equal(fields.questionBankVersion, 'sha256:v1');
});

test('CaseMachine.transitionToCompleted (no-actions path) stamps reportableAt and completedAt together (ADR-0023)', () => {
  const fields = machineForStatus('In-progress').transitionToCompleted(
    () => ({ outcome: 'pass' }),
    { 'q-welcome': { value: 'Yes' } },
    null
  );

  assert.equal(fields.status, 'Completed');
  assert.equal(typeof fields.reportableAt, 'string');
  assert.equal(
    fields.reportableAt,
    fields.completedAt,
    'on the no-actions path reportableAt === completedAt'
  );
  assert.equal(fields.outcomeAtCompletion, 'pass', 'snapshot taken here');
  assert.equal(fields.hadRemediation, false);
  assert.equal(
    Object.hasOwn(fields, 'remediationDueDate'),
    false,
    'no remediation SLA due date on the no-actions path (ADR-0025)'
  );
});

test('CaseMachine.transitionToFinalComplete closes without re-snapshotting (ADR-0023)', () => {
  const fields = machineForStatus(
    'Actions In Progress'
  ).transitionToFinalComplete();

  assert.equal(fields.status, 'Completed');
  assert.equal(
    typeof fields.completedAt,
    'string',
    'completedAt stamped at final close'
  );
  assert.equal(
    Object.hasOwn(fields, 'reportableAt'),
    false,
    'reportableAt was already stamped at Send Actions — not re-stamped'
  );
  assert.equal(
    Object.hasOwn(fields, 'outcomeAtCompletion'),
    false,
    'the outcome was frozen at reportable — no re-snapshot at final complete'
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

  completeBtnOf(el)._listeners['click'][0]();
  await flush();

  assert.equal(
    patches[0]?.questionBankVersion,
    HASH,
    'questionBankVersion from the export hash is included in the completion PATCH'
  );
});
