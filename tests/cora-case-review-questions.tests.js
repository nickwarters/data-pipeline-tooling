// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_ROW,
  CaseReviewHarness,
  SaveQueue,
  fireEvent,
  getByTag,
  makeClient,
  questionSectionOf,
} from './helpers/cora-case-review.js';

// Capability: answer handling, progress, and question navigation.

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
  fireEvent(section, 'cora-answer', {
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
  const answer = (/** @type {string} */ questionId, /** @type {any} */ value) =>
    fireEvent(section, 'cora-answer', { detail: { questionId, value } });

  // 1. q-needs = Yes (triggers q-resolve)
  answer('q-needs', 'Yes');
  // 2. q-resolve = Yes
  answer('q-resolve', 'Yes');
  // 3. q-needs = No (q-resolve hidden)
  answer('q-needs', 'No');

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
  fireEvent(section, 'cora-answer', {
    detail: { questionId: 'q-welcome', value: 'Yes' },
  });

  assert.equal(
    enqueued.length,
    0,
    'cora-answer must not enqueue when questions access is read-only'
  );
});

test('CORACaseReview: cora-group-progress is mounted inside the question section', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = questionSectionOf(el);
  const progressEl = getByTag(section, 'cora-group-progress');
  assert.ok(
    progressEl,
    'cora-group-progress should be mounted inside the question section'
  );
  assert.ok(
    typeof progressEl.update === 'function',
    'cora-group-progress should have an update method'
  );
});

test('CORACaseReview: cora-group-progress.update is called with group data on initial render', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = questionSectionOf(el);
  const progressEl = getByTag(section, 'cora-group-progress');

  /** @type {any[]} */
  const calls = [];
  /** @type {any} */ (progressEl).update = (/** @type {any[]} */ ...args) =>
    calls.push(args);

  // Trigger viewState update by simulating a cora-answer event
  fireEvent(section, 'cora-answer', {
    detail: { questionId: 'q-welcome', value: 'Yes' },
  });

  assert.ok(calls.length > 0, 'update should be called after an answer change');
  const [groups] = calls[0];
  assert.ok(
    Array.isArray(groups),
    'first arg should be an array of group progress entries'
  );
  assert.ok(groups.length > 0, 'should have at least one group');
  assert.ok('group' in groups[0], 'each entry should have a group property');
  assert.ok(
    'answered' in groups[0],
    'each entry should have an answered count'
  );
  assert.ok('total' in groups[0], 'each entry should have a total count');
});

test('CORACaseReview: cora-group-progress.update answered count increases after cora-answer', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = questionSectionOf(el);
  const progressEl = getByTag(section, 'cora-group-progress');

  /** @type {any[][]} */
  const calls = [];
  /** @type {any} */ (progressEl).update = (/** @type {any[]} */ ...args) =>
    calls.push(args);

  // Answer q-welcome (questionGroup: 'Opening')
  fireEvent(section, 'cora-answer', {
    detail: { questionId: 'q-welcome', value: 'Yes' },
  });
  const groups = calls[0][0];
  const opening = groups.find((/** @type {any} */ s) => s.group === 'Opening');
  assert.ok(opening, 'Opening group should be present');
  assert.equal(opening.answered, 1);
  assert.equal(opening.total, 1);
});

test('CORACaseReview: cora-group-progress receives unanswered applicable questions list', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = questionSectionOf(el);
  const progressEl = getByTag(section, 'cora-group-progress');

  /** @type {any[][]} */
  const calls = [];
  /** @type {any} */ (progressEl).update = (/** @type {any[]} */ ...args) =>
    calls.push(args);

  fireEvent(section, 'cora-answer', {
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

test('CORACaseReview: cora-group-jump event scrolls first question of that group', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = questionSectionOf(el);
  const questionList = getByTag(section, 'cora-question-list');
  let scrolled = false;
  questionList.questionElements = [
    {
      question: { questionGroup: 'Opening' },
      scrollIntoView() {
        scrolled = true;
      },
    },
  ];

  fireEvent(section, 'cora-group-jump', {
    detail: { group: 'Opening' },
  });

  assert.equal(scrolled, true, 'the matching question is scrolled into view');
});

test('CORACaseReview: cora-jump-unanswered handler calls scrollIntoView on first unanswered question element', async () => {
  const el = new CaseReviewHarness();
  el.client = /** @type {any} */ (makeClient());
  el.saveQueue = new SaveQueue(/** @type {any} */ (el.client));
  el.caseId = 'c1';
  await el.connectedCallback();

  const section = questionSectionOf(el);
  const qList = getByTag(section, 'cora-question-list');

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
  fireEvent(section, 'cora-answer', {
    detail: { questionId: 'q-welcome', value: 'Yes' },
  });

  fireEvent(section, 'cora-jump-unanswered');

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
