// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';
import {
  BASE_ROW,
  CaseReviewHarness,
  SaveQueue,
  assertAllCoraElementsDefined,
  conversationOf,
  detailsOf,
  fireEvent,
  getByTag,
  makeClient,
  notesOf,
  panelOf,
  queryAllByTag,
  questionSectionOf,
  remediationOf,
  rootOf,
  summaryOf,
  tabFor,
  tabsOf,
} from './helpers/cora-case-review.js';

isolateBrowserGlobals();

// Capability: page loading, access, tabs, panels, and persistent chrome.

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

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
  assertAllCoraElementsDefined(el);
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

test('CORACaseReview: each tab panel carries the matching Section content node', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  // The Questions panel holds the public question-list and progress elements;
  // the others are their respective custom elements.
  assert.ok(getByTag(questionSectionOf(el), 'cora-question-list'));
  assert.ok(getByTag(questionSectionOf(el), 'cora-group-progress'));
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

  // Notes renders from the Case row (the single source of truth, issue #317).
  const notes = notesOf(el);
  assert.equal(notes.caseRow.notes, 'general note');
  assert.equal(notes.caseRow.caseJustification, 'why this case passes');
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

  fireEvent(tabsOf(el), 'cora-tab-change', { detail: { id: 'notes' } });

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
  fireEvent(section, 'cora-answer', {
    detail: { questionId: 'q-welcome', value: 'Yes' },
  });
  fireEvent(tabsOf(el), 'cora-tab-change', { detail: { id: 'summary' } });

  assert.equal(getCaseCalls, 1, 'switching tabs must not refetch the Case');
  // The same qList element keeps receiving updates: the answers signal survived.
  const qList = getByTag(section, 'cora-question-list');
  assert.equal(
    qList._update[1]['q-welcome'].value,
    'Yes',
    'the live answer edit is preserved across the tab switch'
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
  assert.equal(rootOf(el).childElementCount, 0);
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

  const msg = getByTag(rootOf(el), 'p');
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

  const panel = getByTag(rootOf(el), 'section');
  assert.equal(panel.className, 'cora-access-denied');
});

test('CORACaseReview: no inline cora-save-status paragraph in rendered children', async () => {
  const client = makeClient();
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (client);
  el.saveQueue = new SaveQueue(/** @type {any} */ (client));
  el.caseId = 'c1';
  await el.connectedCallback();

  assert.equal(
    queryAllByTag(rootOf(el), 'p').some(
      (paragraph) => paragraph.className === 'cora-save-status'
    ),
    false,
    'inline save-status paragraph must not appear; cora-status-banner handles display'
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
  assert.equal(
    remediation.querySelector('.cora-attribute-responsible'),
    null,
    'no Responsible Party quick-pick is rendered for an empty account'
  );
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
    remediation.querySelector('.cora-attribute-menu'),
    null,
    'Completed case renders no attribution controls'
  );
  assert.equal(
    enqueued.length,
    0,
    'a frozen attribution must not enqueue even if an event fires'
  );
});
