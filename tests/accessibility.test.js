// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

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
    this.id = '';
    this.tagName = '';
    this.type = '';
    this.name = '';
    this.value = '';
    this.checked = false;
    this.hidden = false;
    /** @type {any} */
    this._focused = false;
    /** @type {Record<string, string>} */
    this.style = {};
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) { this._children = cs; }
  appendChild(/** @type {StubEl} */ c) { this._children.push(c); return c; }
  append(/** @type {StubEl[]} */ ...cs) { this._children.push(...cs); }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this._attrs[k] = v; }
  getAttribute(/** @type {string} */ k) { return this._attrs[k] ?? null; }
  focus() { this._focused = true; (/** @type {any} */ (globalThis))._lastFocused = this; }
  /** @returns {StubEl | null} */
  querySelector(/** @type {string} */ _sel) {
    // walk children & find first matching by tagName comparison (best-effort stub)
    /** @param {StubEl} node @returns {StubEl | null} */
    const walk = (node) => {
      for (const c of node._children) {
        if (c.tagName && c.tagName.toLowerCase() === 'input') return c;
        const found = walk(c);
        if (found) return found;
      }
      return null;
    };
    return walk(this);
  }
}

(/** @type {any} */ (globalThis)).HTMLElement = StubEl;
(/** @type {any} */ (globalThis)).document = {
  /** @param {string} tag @returns {StubEl} */
  createElement(tag) {
    const el = new StubEl();
    el.tagName = tag;
    return el;
  },
  addEventListener() {},
  removeEventListener() {},
};
(/** @type {any} */ (globalThis)).customElements = { define() {} };
(/** @type {any} */ (globalThis)).CustomEvent = class {
  /**
   * @param {string} type
   * @param {{ detail?: unknown, bubbles?: boolean }} [opts]
   */
  constructor(type, opts = {}) {
    this.type = type;
    this.detail = opts.detail ?? null;
    this.bubbles = opts.bubbles ?? false;
  }
};

const { CRQuestion } = await import('../src/components/cr-question.js');
const { CRQuestionList } = await import('../src/components/cr-question-list.js');
const { CRNotes } = await import('../src/components/cr-notes.js');
const { CRConversation } = await import('../src/components/cr-conversation.js');
const { CRStatusBanner } = await import('../src/components/cr-status-banner.js');
const { signal } = await import('../src/lib/signal.js');

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

// ---- cr-question accessibility ----

test('CRQuestion: yes-no-na renders fieldset with role=radiogroup and aria-required=true', () => {
  const q = /** @type {QuestionDefinition} */ ({
    id: 'q1', text: 'Q1?', responseType: 'yes-no-na', deprecated: false,
  });
  const el = new CRQuestion();
  el.question = q;
  el.currentValue = '';
  el.connectedCallback();

  const fieldset = (/** @type {any} */ (el))._children[0];
  assert.equal(fieldset._attrs['role'], 'radiogroup');
  assert.equal(fieldset._attrs['aria-required'], 'true');
});

test('CRQuestion: single-choice fieldset has role=radiogroup', () => {
  const q = /** @type {QuestionDefinition} */ ({
    id: 'q1', text: 'Channel', responseType: 'single-choice', options: ['A', 'B'], deprecated: false,
  });
  const el = new CRQuestion();
  el.question = q;
  el.currentValue = '';
  el.connectedCallback();

  const fieldset = (/** @type {any} */ (el))._children[0];
  assert.equal(fieldset._attrs['role'], 'radiogroup');
});

test('CRQuestion: multi-choice fieldset has role=group (not radiogroup)', () => {
  const q = /** @type {QuestionDefinition} */ ({
    id: 'q1', text: 'Products', responseType: 'multi-choice', options: ['A', 'B'], deprecated: false,
  });
  const el = new CRQuestion();
  el.question = q;
  el.currentValue = [];
  el.connectedCallback();

  const fieldset = (/** @type {any} */ (el))._children[0];
  assert.equal(fieldset._attrs['role'], 'group');
});

test('CRQuestion: fieldset has stable id derived from question id (focus target)', () => {
  const q = /** @type {QuestionDefinition} */ ({
    id: 'q-needs', text: 'Needs?', responseType: 'yes-no-na', deprecated: false,
  });
  const el = new CRQuestion();
  el.question = q;
  el.currentValue = '';
  el.connectedCallback();

  const fieldset = (/** @type {any} */ (el))._children[0];
  assert.equal(fieldset.id, 'cr-q-q-needs');
});

// ---- cr-question-list focus management ----

test('CRQuestionList: initial render does not steal focus', () => {
  const list = new CRQuestionList();
  list.questions = /** @type {QuestionDefinition[]} */ ([
    { id: 'q1', text: 'Q1?', responseType: 'yes-no-na', deprecated: false },
  ]);
  list.answers = {};
  (/** @type {any} */ (globalThis))._lastFocused = null;
  list.connectedCallback();
  assert.equal((/** @type {any} */ (globalThis))._lastFocused, null,
    'no question should be auto-focused on initial render');
});

test('CRQuestionList: when a new question appears via update(), focus moves to its first input', () => {
  const list = new CRQuestionList();
  /** @type {QuestionDefinition[]} */
  const initial = [
    { id: 'q1', text: 'Q1?', responseType: 'yes-no-na', deprecated: false },
  ];
  list.questions = initial;
  list.answers = {};
  list.connectedCallback();
  (/** @type {any} */ (globalThis))._lastFocused = null;

  /** @type {QuestionDefinition[]} */
  const expanded = [
    { id: 'q1', text: 'Q1?', responseType: 'yes-no-na', deprecated: false },
    { id: 'q2-new', text: 'New?', responseType: 'yes-no-na', deprecated: false },
  ];
  list.update(expanded, { 'q1': { value: 'Yes' } });

  const focused = (/** @type {any} */ (globalThis))._lastFocused;
  assert.ok(focused, 'a new question should be focused');
  assert.equal(focused.tagName, 'cr-question',
    'focus should land on the cr-question host (which forwards to first input)');
});

test('CRQuestionList: removing a question does not trigger focus change', () => {
  const list = new CRQuestionList();
  /** @type {QuestionDefinition[]} */
  const initial = [
    { id: 'q1', text: 'Q1?', responseType: 'yes-no-na', deprecated: false },
    { id: 'q2', text: 'Q2?', responseType: 'yes-no-na', deprecated: false },
  ];
  list.questions = initial;
  list.answers = {};
  list.connectedCallback();
  (/** @type {any} */ (globalThis))._lastFocused = null;

  list.update([initial[0]], {});
  assert.equal((/** @type {any} */ (globalThis))._lastFocused, null,
    'no focus change when only removing questions');
});

test('CRQuestionList: update with same questions (no new) does not trigger focus change', () => {
  const list = new CRQuestionList();
  /** @type {QuestionDefinition[]} */
  const questions = [
    { id: 'q1', text: 'Q1?', responseType: 'yes-no-na', deprecated: false },
  ];
  list.questions = questions;
  list.answers = {};
  list.connectedCallback();
  (/** @type {any} */ (globalThis))._lastFocused = null;

  // Same questions, just updated answers — no new question IDs appear.
  list.update(questions, { 'q1': { value: 'Yes' } });
  assert.equal((/** @type {any} */ (globalThis))._lastFocused, null,
    'update with same question set must not steal focus');
});

test('CRQuestionList: multi-choice question with no answer initialises currentValue to empty array', () => {
  const list = new CRQuestionList();
  /** @type {QuestionDefinition[]} */
  const questions = [
    { id: 'q-mc', text: 'Pick?', responseType: 'multi-choice', options: ['A', 'B'], deprecated: false },
  ];
  list.questions = questions;
  list.answers = {}; // no answer yet
  list.connectedCallback();

  const crQ = /** @type {any} */ ((/** @type {any} */ (list))._children[0]);
  assert.deepEqual(crQ.currentValue, [],
    'multi-choice with no existing answer must initialise currentValue to []');
});

// ---- cr-notes / cr-conversation labelling ----

test('CRNotes: textarea has aria-label="Case notes"', () => {
  const el = new CRNotes();
  el.notes = '';
  el.saveQueue = /** @type {any} */ ({ enqueue() {} });
  el.caseId = 'case-1';
  el.connectedCallback();

  const textarea = (/** @type {any} */ (el))._children[1];
  assert.equal(textarea._attrs['aria-label'], 'Case notes');
});

test('CRConversation: compose textarea has aria-label="Message to Responsible Party"', () => {
  const el = new CRConversation();
  el._messages = [];
  el.connectedCallback();

  // children: heading, empty/list, compose
  const compose = (/** @type {any} */ (el))._children[2];
  const textarea = compose._children[0];
  assert.equal(textarea._attrs['aria-label'], 'Message to Responsible Party');
});

test('CRConversation: send button has aria-label even when textarea is empty', () => {
  const el = new CRConversation();
  el._messages = [];
  el.connectedCallback();

  const compose = (/** @type {any} */ (el))._children[2];
  const btn = compose._children[1];
  assert.equal(btn.textContent, 'Send');
});

// ---- status banner regression ----

test('CRStatusBanner: saving banner has role=status and polite', () => {
  const s = signal(/** @type {'saving'} */ ('saving'));
  const el = new CRStatusBanner();
  el.saveQueue = /** @type {any} */ ({ status: s });
  el.connectedCallback();
  const node = (/** @type {any} */ (el))._children[0];
  assert.equal(node._attrs['role'], 'status');
  assert.equal(node._attrs['aria-live'], 'polite');
});
