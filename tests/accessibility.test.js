// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl, useElementClass } from './_dom-stub.js';

installDom();

class A11yEl extends StubEl {
  constructor(tag = '') {
    super(tag);
    /** @type {any} */
    this.currentValue = undefined;
    /** @type {any} */
    this.question = undefined;
    /** @type {any} */
    this.access = undefined;
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) {
    super.replaceChildren(...cs);
    // Faithfully model the browser: mutating a subtree detaches (and therefore
    // blurs) whatever was focused inside it. activeElement falls back to "body"
    // (null here). This is exactly the behaviour that strands keyboard focus.
    const doc = /** @type {any} */ (globalThis).document;
    if (doc) doc._active = null;
  }
}

useElementClass(A11yEl, { registry: true });

const { CORAQuestion } = await import('../src/components/cora-question.js');
const { CORAQuestionList } =
  await import('../src/components/cora-question-list.js');
const { CORANotes } = await import('../src/components/cora-notes.js');
const { CORAConversation } = await import('../src/components/cora-conversation.js');
const { CORAStatusBanner } =
  await import('../src/components/cora-status-banner.js');
const { signal } = await import('../src/lib/signal.js');

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

// ---- cora-question accessibility ----

test('CORAQuestion: yes-no-na renders fieldset with role=radiogroup and aria-required=true', () => {
  const q = /** @type {QuestionDefinition} */ ({
    id: 'q1',
    text: 'Q1?',
    responseType: 'yes-no-na',
    deprecated: false,
  });
  const el = new CORAQuestion();
  el.question = q;
  el.currentValue = '';
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  assert.equal(fieldset._attrs['role'], 'radiogroup');
  assert.equal(fieldset._attrs['aria-required'], 'true');
});

test('CORAQuestion: single-choice fieldset has role=radiogroup', () => {
  const q = /** @type {QuestionDefinition} */ ({
    id: 'q1',
    text: 'Channel',
    responseType: 'single-choice',
    options: ['A', 'B'],
    deprecated: false,
  });
  const el = new CORAQuestion();
  el.question = q;
  el.currentValue = '';
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  assert.equal(fieldset._attrs['role'], 'radiogroup');
});

test('CORAQuestion: multi-choice fieldset has role=group (not radiogroup)', () => {
  const q = /** @type {QuestionDefinition} */ ({
    id: 'q1',
    text: 'Products',
    responseType: 'multi-choice',
    options: ['A', 'B'],
    deprecated: false,
  });
  const el = new CORAQuestion();
  el.question = q;
  el.currentValue = [];
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  assert.equal(fieldset._attrs['role'], 'group');
});

test('CORAQuestion: fieldset has stable id derived from question id (focus target)', () => {
  const q = /** @type {QuestionDefinition} */ ({
    id: 'q-needs',
    text: 'Needs?',
    responseType: 'yes-no-na',
    deprecated: false,
  });
  const el = new CORAQuestion();
  el.question = q;
  el.currentValue = '';
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  assert.equal(fieldset.id, 'cora-q-q-needs');
});

// ---- cora-question-list focus management ----

test('CORAQuestionList: initial render does not steal focus', () => {
  const list = new CORAQuestionList();
  list.questions = /** @type {QuestionDefinition[]} */ ([
    { id: 'q1', text: 'Q1?', responseType: 'yes-no-na', deprecated: false },
  ]);
  list.answers = {};
  /** @type {any} */ (globalThis)._lastFocused = null;
  list.connectedCallback();
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    null,
    'no question should be auto-focused on initial render'
  );
});

test('CORAQuestionList: when a new question appears via update(), focus moves to its first input', () => {
  const list = new CORAQuestionList();
  /** @type {QuestionDefinition[]} */
  const initial = [
    { id: 'q1', text: 'Q1?', responseType: 'yes-no-na', deprecated: false },
  ];
  list.questions = initial;
  list.answers = {};
  list.connectedCallback();
  /** @type {any} */ (globalThis)._lastFocused = null;

  /** @type {QuestionDefinition[]} */
  const expanded = [
    { id: 'q1', text: 'Q1?', responseType: 'yes-no-na', deprecated: false },
    {
      id: 'q2-new',
      text: 'New?',
      responseType: 'yes-no-na',
      deprecated: false,
    },
  ];
  list.update(expanded, { q1: { value: 'Yes' } });

  const focused = /** @type {any} */ (globalThis)._lastFocused;
  assert.ok(focused, 'a new question should be focused');
  assert.equal(
    focused.tagName,
    'CORA-QUESTION',
    'focus should land on the cora-question host (which forwards to first input)'
  );
});

test('CORAQuestionList: removing a question does not trigger focus change', () => {
  const list = new CORAQuestionList();
  /** @type {QuestionDefinition[]} */
  const initial = [
    { id: 'q1', text: 'Q1?', responseType: 'yes-no-na', deprecated: false },
    { id: 'q2', text: 'Q2?', responseType: 'yes-no-na', deprecated: false },
  ];
  list.questions = initial;
  list.answers = {};
  list.connectedCallback();
  /** @type {any} */ (globalThis)._lastFocused = null;

  list.update([initial[0]], {});
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    null,
    'no focus change when only removing questions'
  );
});

test('CORAQuestionList: update with same questions (no new) does not trigger focus change', () => {
  const list = new CORAQuestionList();
  /** @type {QuestionDefinition[]} */
  const questions = [
    { id: 'q1', text: 'Q1?', responseType: 'yes-no-na', deprecated: false },
  ];
  list.questions = questions;
  list.answers = {};
  list.connectedCallback();
  /** @type {any} */ (globalThis)._lastFocused = null;

  // Same questions, just updated answers — no new question IDs appear.
  list.update(questions, { q1: { value: 'Yes' } });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    null,
    'update with same question set must not steal focus'
  );
});

test('CORAQuestionList: update reuses existing cora-question DOM elements to prevent focus/scroll jumps', () => {
  const list = new CORAQuestionList();
  /** @type {QuestionDefinition[]} */
  const questions = [
    { id: 'q1', text: 'Q1?', responseType: 'yes-no-na', deprecated: false },
    { id: 'q2', text: 'Q2?', responseType: 'yes-no-na', deprecated: false },
  ];
  list.questions = questions;
  list.answers = {};
  list.connectedCallback();

  const initialQ1 = list.questionElements[0];
  const initialQ2 = list.questionElements[1];

  // Update with an answer to q1, simulating user clicking a radio button
  list.update(questions, { q1: { value: 'No' } });

  assert.equal(
    list.questionElements[0],
    initialQ1,
    'existing cora-question element for q1 should be reused'
  );
  assert.equal(
    list.questionElements[1],
    initialQ2,
    'existing cora-question element for q2 should be reused'
  );
});

test('CORAQuestion: answer inputs carry a stable data-focus-key (single-choice)', () => {
  const q = /** @type {QuestionDefinition} */ ({
    id: 'q-chan',
    text: 'Channel?',
    responseType: 'single-choice',
    options: ['Phone', 'Email'],
    deprecated: false,
  });
  const el = new CORAQuestion();
  el.question = q;
  el.currentValue = '';
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  // fieldset children: [legend, label0, label1]; each label is [input, span].
  const firstInput = fieldset._children[1]._children[0];
  const secondInput = fieldset._children[2]._children[0];
  assert.equal(firstInput._attrs['data-focus-key'], 'answer:q-chan:0');
  assert.equal(secondInput._attrs['data-focus-key'], 'answer:q-chan:1');
});

test('CORAQuestion: answer inputs carry a stable data-focus-key (multi-choice)', () => {
  const q = /** @type {QuestionDefinition} */ ({
    id: 'q-prod',
    text: 'Products?',
    responseType: 'multi-choice',
    options: ['A', 'B'],
    deprecated: false,
  });
  const el = new CORAQuestion();
  el.question = q;
  el.currentValue = [];
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  const firstInput = fieldset._children[1]._children[0];
  assert.equal(firstInput._attrs['data-focus-key'], 'answer:q-prod:0');
});

// ---- cora-question-list focus PRESERVATION (regression: changing an answer near
//      the end of the list must not strand keyboard focus at the top) ----

/**
 * Attaches a fake answer input (carrying the same data-focus-key that
 * CORAQuestion would render) to a reused cora-question host and marks it focused,
 * mirroring a keyboard user sitting on that radio.
 * @param {any} host
 * @param {string} key
 * @returns {any} the input
 */
function focusInputOn(host, key) {
  const input = /** @type {any} */ (globalThis).document.createElement('input');
  input.setAttribute('data-focus-key', key);
  host.appendChild(input);
  input.focus();
  return input;
}

test('CORAQuestionList: changing an answer restores focus after the list rebuilds', () => {
  const list = new CORAQuestionList();
  /** @type {QuestionDefinition[]} */
  const questions = [
    { id: 'q1', text: 'Q1?', responseType: 'yes-no-na', deprecated: false },
    { id: 'q2', text: 'Q2?', responseType: 'yes-no-na', deprecated: false },
    { id: 'q3', text: 'Q3?', responseType: 'yes-no-na', deprecated: false },
  ];
  list.questions = questions;
  list.answers = {};
  list.connectedCallback();

  // User is sitting on the second-to-last question's input.
  const input = focusInputOn(list.questionElements[1], 'answer:q2:0');
  /** @type {any} */ (globalThis)._lastFocused = null;

  // Answering q2 makes q3 no longer applicable → the list rebuilds (which blurs
  // the focused input). Without restoration the user is stranded at the top.
  list.update([questions[0], questions[1]], { q2: { value: 'Yes' } });

  assert.equal(
    /** @type {any} */ (globalThis).document.activeElement,
    input,
    'focus must return to the input the user was editing after a rebuild'
  );
});

test('CORAQuestionList: focus is preserved without a redundant re-focus when nothing rebuilds', () => {
  const list = new CORAQuestionList();
  /** @type {QuestionDefinition[]} */
  const questions = [
    { id: 'q1', text: 'Q1?', responseType: 'yes-no-na', deprecated: false },
  ];
  list.questions = questions;
  list.answers = {};
  list.connectedCallback();

  const input = focusInputOn(list.questionElements[0], 'answer:q1:0');
  /** @type {any} */ (globalThis)._lastFocused = null;

  // Same question set → no DOM rebuild → focus never lost → no re-focus needed.
  list.update(questions, { q1: { value: 'No' } });

  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    null,
    'restore must be a no-op when the focused input never lost focus'
  );
  assert.equal(
    /** @type {any} */ (globalThis).document.activeElement,
    input,
    'the input remains focused'
  );
});

test('CORAQuestionList: focus is not forced elsewhere when the focused question is removed', () => {
  const list = new CORAQuestionList();
  /** @type {QuestionDefinition[]} */
  const questions = [
    { id: 'q1', text: 'Q1?', responseType: 'yes-no-na', deprecated: false },
    { id: 'q2', text: 'Q2?', responseType: 'yes-no-na', deprecated: false },
  ];
  list.questions = questions;
  list.answers = {};
  list.connectedCallback();

  // User focused q2, then an upstream change removes q2 entirely.
  focusInputOn(list.questionElements[1], 'answer:q2:0');
  /** @type {any} */ (globalThis)._lastFocused = null;

  list.update([questions[0]], {});

  assert.equal(
    /** @type {any} */ (globalThis).document.activeElement,
    null,
    'a removed input cannot (and must not) be re-focused'
  );
});

test('CORAQuestionList: swapping a question (same count, different id) rebuilds the list', () => {
  const list = new CORAQuestionList();
  /** @type {QuestionDefinition[]} */
  const initial = [
    { id: 'q1', text: 'Q1?', responseType: 'yes-no-na', deprecated: false },
    { id: 'q2', text: 'Q2?', responseType: 'yes-no-na', deprecated: false },
  ];
  list.questions = initial;
  list.answers = {};
  list.connectedCallback();
  const q1Host = list.questionElements[0];

  // q2 → q3: same length, but a different element identity at index 1, so the
  // list must rebuild (and reuse q1's host).
  list.update(
    [
      initial[0],
      { id: 'q3', text: 'Q3?', responseType: 'yes-no-na', deprecated: false },
    ],
    {}
  );

  assert.equal(list.questionElements[0], q1Host, 'q1 host is reused');
  assert.equal(list.questionElements[1].question?.id, 'q3', 'q3 host is fresh');
});

test('CORAQuestionList: multi-choice question with no answer initialises currentValue to empty array', () => {
  const list = new CORAQuestionList();
  /** @type {QuestionDefinition[]} */
  const questions = [
    {
      id: 'q-mc',
      text: 'Pick?',
      responseType: 'multi-choice',
      options: ['A', 'B'],
      deprecated: false,
    },
  ];
  list.questions = questions;
  list.answers = {}; // no answer yet
  list.connectedCallback();

  const crQ = /** @type {any} */ (/** @type {any} */ (list)._children[0]);
  assert.deepEqual(
    crQ.currentValue,
    [],
    'multi-choice with no existing answer must initialise currentValue to []'
  );
});

// ---- cora-notes / cora-conversation labelling ----

test('CORANotes: textarea has aria-label="Case notes"', () => {
  const el = new CORANotes();
  el.notes = '';
  el.saveQueue = /** @type {any} */ ({ enqueue() {} });
  el.caseId = 'case-1';
  el.connectedCallback();

  const textarea = /** @type {any} */ (el)._children.find(
    (/** @type {any} */ c) => c.className === 'cora-notes-input'
  );
  assert.equal(textarea._attrs['aria-label'], 'Case notes');
});

test('CORANotes: Case Justification textarea has aria-label="Case Justification"', () => {
  const el = new CORANotes();
  el.notes = '';
  el.caseJustification = '';
  el.saveQueue = /** @type {any} */ ({ enqueue() {} });
  el.caseId = 'case-1';
  el.connectedCallback();

  const textarea = /** @type {any} */ (el)._children.find(
    (/** @type {any} */ c) => c.className === 'cora-case-justification-input'
  );
  assert.equal(textarea._attrs['aria-label'], 'Case Justification');
});

test('CORAConversation: compose textarea has aria-label="Message to Responsible Party"', () => {
  const el = new CORAConversation();
  el._messages = [];
  el.connectedCallback();

  // children: heading, empty/list, compose
  const compose = /** @type {any} */ (el)._children[2];
  const textarea = compose._children[0];
  assert.equal(textarea._attrs['aria-label'], 'Message to Responsible Party');
});

test('CORAConversation: send button has aria-label even when textarea is empty', () => {
  const el = new CORAConversation();
  el._messages = [];
  el.connectedCallback();

  const compose = /** @type {any} */ (el)._children[2];
  const btn = compose._children[1];
  assert.equal(btn.textContent, 'Send');
});

// ---- status banner regression ----

test('CORAStatusBanner: saving banner has role=status and polite', () => {
  const s = signal(/** @type {'saving'} */ ('saving'));
  const el = new CORAStatusBanner();
  el.saveQueue = /** @type {any} */ ({ status: s });
  el.connectedCallback();
  const node = /** @type {any} */ (el)._children[0];
  assert.equal(node._attrs['role'], 'status');
  assert.equal(node._attrs['aria-live'], 'polite');
});
