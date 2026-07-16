// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_ROW,
  CaseReviewHarness,
  SaveQueue,
  bannerOf,
  completeBtnOf,
  conversationOf,
  fireEvent,
  getByRole,
  headerOf,
  makeClient,
  tabFor,
} from './helpers/cora-case-review.js';

// Capability: conversation mounting, toggling, and keyboard interaction.

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
  const toggleBtn = getByRole(headerOf(el), 'button', {
    name: /Toggle conversation panel/,
  });
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

test('CORACaseReview: toggle button is in the header when conversation access is not hidden', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const header = headerOf(el);
  const toggleBtn = getByRole(header, 'button', {
    name: /Toggle conversation panel/,
  });
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
  const toggleBtn = getByRole(header, 'button', {
    name: /Toggle conversation panel/,
  });

  fireEvent(toggleBtn, 'click');
  assert.equal(
    conversationEl.hidden,
    false,
    'first click should show the panel'
  );
  assert.equal(toggleBtn.getAttribute('aria-expanded'), 'true');

  fireEvent(toggleBtn, 'click');
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

test('CORACaseReview: an Alt+C keydown on the document toggles the conversation panel', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const conversationEl = conversationOf(el);
  assert.equal(conversationEl.hidden, true, 'conversation starts hidden');

  fireEvent(globalThis.document, 'keydown', {
    altKey: true,
    code: 'KeyC',
  });

  assert.equal(
    conversationEl.hidden,
    false,
    'Alt+C on the document shows the panel via the page-registered listener'
  );
});

test('CORACaseReview: disconnectedCallback tears down the conversation binding without throwing', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  assert.doesNotThrow(() => el.disconnectedCallback());
});
