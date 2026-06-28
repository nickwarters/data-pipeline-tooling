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
    this.currentValue = undefined;
    /** @type {any} */
    this.question = undefined;
    /** @type {any} */
    this.access = undefined;
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) {
    this._children = cs;
    // Faithfully model the browser: mutating a subtree detaches (and therefore
    // blurs) whatever was focused inside it. activeElement falls back to "body"
    // (null here). This is exactly the behaviour that strands keyboard focus.
    const doc = /** @type {any} */ (globalThis).document;
    if (doc) doc._active = null;
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
  focus() {
    this._focused = true;
    /** @type {any} */ (globalThis)._lastFocused = this;
    const doc = /** @type {any} */ (globalThis).document;
    if (doc) doc._active = this;
  }
  /** @returns {StubEl | null} */
  querySelector(/** @type {string} */ sel) {
    const keyMatch = sel.startsWith('[data-focus-key=');
    const wantKey = keyMatch ? sel.slice('[data-focus-key="'.length, -2) : null;
    /** @param {StubEl} node @returns {StubEl | null} */
    const walk = (node) => {
      for (const c of node._children) {
        if (keyMatch) {
          if (c.getAttribute('data-focus-key') === wantKey) return c;
        } else if (c.tagName && c.tagName.toLowerCase() === 'input') {
          return c;
        }
        const found = walk(c);
        if (found) return found;
      }
      return null;
    };
    return walk(this);
  }
}

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).document = {
  _active: /** @type {StubEl | null} */ (null),
  get activeElement() {
    return this._active;
  },
  /** @param {string} tag @returns {StubEl} */
  createElement(tag) {
    const cls = /** @type {any} */ (globalThis).customElements?._registry?.[
      tag
    ];
    const el = cls ? new cls() : new StubEl();
    el.tagName = tag;
    return el;
  },
  addEventListener() {},
  removeEventListener() {},
};
/** @type {any} */ (globalThis).customElements = {
  /** @type {Record<string, any>} */
  _registry: {},
  define(/** @type {string} */ name, /** @type {any} */ cls) {
    this._registry[name] = cls;
  },
};
/** @type {any} */ (globalThis).CustomEvent = class {
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
const { CRQuestionList } =
  await import('../src/components/cr-question-list.js');
const { CRNotes } = await import('../src/components/cr-notes.js');
const { CRConversation } = await import('../src/components/cr-conversation.js');
const { CRStatusBanner } =
  await import('../src/components/cr-status-banner.js');
const { signal } = await import('../src/lib/signal.js');

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

// ---- cr-question accessibility ----

test('CRQuestion: yes-no-na renders fieldset with role=radiogroup and aria-required=true', () => {
  const q = /** @type {QuestionDefinition} */ ({
    id: 'q1',
    text: 'Q1?',
    responseType: 'yes-no-na',
    deprecated: false,
  });
  const el = new CRQuestion();
  el.question = q;
  el.currentValue = '';
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  assert.equal(fieldset._attrs['role'], 'radiogroup');
  assert.equal(fieldset._attrs['aria-required'], 'true');
});

test('CRQuestion: single-choice fieldset has role=radiogroup', () => {
  const q = /** @type {QuestionDefinition} */ ({
    id: 'q1',
    text: 'Channel',
    responseType: 'single-choice',
    options: ['A', 'B'],
    deprecated: false,
  });
  const el = new CRQuestion();
  el.question = q;
  el.currentValue = '';
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  assert.equal(fieldset._attrs['role'], 'radiogroup');
});

test('CRQuestion: multi-choice fieldset has role=group (not radiogroup)', () => {
  const q = /** @type {QuestionDefinition} */ ({
    id: 'q1',
    text: 'Products',
    responseType: 'multi-choice',
    options: ['A', 'B'],
    deprecated: false,
  });
  const el = new CRQuestion();
  el.question = q;
  el.currentValue = [];
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  assert.equal(fieldset._attrs['role'], 'group');
});

test('CRQuestion: fieldset has stable id derived from question id (focus target)', () => {
  const q = /** @type {QuestionDefinition} */ ({
    id: 'q-needs',
    text: 'Needs?',
    responseType: 'yes-no-na',
    deprecated: false,
  });
  const el = new CRQuestion();
  el.question = q;
  el.currentValue = '';
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  assert.equal(fieldset.id, 'cr-q-q-needs');
});

// ---- cr-question-list focus management ----

test('CRQuestionList: initial render does not steal focus', () => {
  const list = new CRQuestionList();
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

test('CRQuestionList: when a new question appears via update(), focus moves to its first input', () => {
  const list = new CRQuestionList();
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
    'cr-question',
    'focus should land on the cr-question host (which forwards to first input)'
  );
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
  /** @type {any} */ (globalThis)._lastFocused = null;

  list.update([initial[0]], {});
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    null,
    'no focus change when only removing questions'
  );
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
  /** @type {any} */ (globalThis)._lastFocused = null;

  // Same questions, just updated answers — no new question IDs appear.
  list.update(questions, { q1: { value: 'Yes' } });
  assert.equal(
    /** @type {any} */ (globalThis)._lastFocused,
    null,
    'update with same question set must not steal focus'
  );
});

test('CRQuestionList: update reuses existing cr-question DOM elements to prevent focus/scroll jumps', () => {
  const list = new CRQuestionList();
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
    'existing cr-question element for q1 should be reused'
  );
  assert.equal(
    list.questionElements[1],
    initialQ2,
    'existing cr-question element for q2 should be reused'
  );
});

test('CRQuestion: answer inputs carry a stable data-focus-key (single-choice)', () => {
  const q = /** @type {QuestionDefinition} */ ({
    id: 'q-chan',
    text: 'Channel?',
    responseType: 'single-choice',
    options: ['Phone', 'Email'],
    deprecated: false,
  });
  const el = new CRQuestion();
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

test('CRQuestion: answer inputs carry a stable data-focus-key (multi-choice)', () => {
  const q = /** @type {QuestionDefinition} */ ({
    id: 'q-prod',
    text: 'Products?',
    responseType: 'multi-choice',
    options: ['A', 'B'],
    deprecated: false,
  });
  const el = new CRQuestion();
  el.question = q;
  el.currentValue = [];
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  const firstInput = fieldset._children[1]._children[0];
  assert.equal(firstInput._attrs['data-focus-key'], 'answer:q-prod:0');
});

// ---- cr-question-list focus PRESERVATION (regression: changing an answer near
//      the end of the list must not strand keyboard focus at the top) ----

/**
 * Attaches a fake answer input (carrying the same data-focus-key that
 * CRQuestion would render) to a reused cr-question host and marks it focused,
 * mirroring a keyboard user sitting on that radio.
 * @param {any} host
 * @param {string} key
 * @returns {any} the input
 */
function focusInputOn(host, key) {
  const input = /** @type {any} */ (globalThis).document.createElement('input');
  input.tagName = 'input';
  input.setAttribute('data-focus-key', key);
  host.appendChild(input);
  input.focus();
  return input;
}

test('CRQuestionList: changing an answer restores focus after the list rebuilds', () => {
  const list = new CRQuestionList();
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

test('CRQuestionList: focus is preserved without a redundant re-focus when nothing rebuilds', () => {
  const list = new CRQuestionList();
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

test('CRQuestionList: focus is not forced elsewhere when the focused question is removed', () => {
  const list = new CRQuestionList();
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

test('CRQuestionList: swapping a question (same count, different id) rebuilds the list', () => {
  const list = new CRQuestionList();
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

test('CRQuestionList: multi-choice question with no answer initialises currentValue to empty array', () => {
  const list = new CRQuestionList();
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

// ---- cr-notes / cr-conversation labelling ----

test('CRNotes: textarea has aria-label="Case notes"', () => {
  const el = new CRNotes();
  el.notes = '';
  el.saveQueue = /** @type {any} */ ({ enqueue() {} });
  el.caseId = 'case-1';
  el.connectedCallback();

  const textarea = /** @type {any} */ (el)._children.find(
    (/** @type {any} */ c) => c.className === 'cr-notes-input'
  );
  assert.equal(textarea._attrs['aria-label'], 'Case notes');
});

test('CRNotes: Case Justification textarea has aria-label="Case Justification"', () => {
  const el = new CRNotes();
  el.notes = '';
  el.caseJustification = '';
  el.saveQueue = /** @type {any} */ ({ enqueue() {} });
  el.caseId = 'case-1';
  el.connectedCallback();

  const textarea = /** @type {any} */ (el)._children.find(
    (/** @type {any} */ c) => c.className === 'cr-case-justification-input'
  );
  assert.equal(textarea._attrs['aria-label'], 'Case Justification');
});

test('CRConversation: compose textarea has aria-label="Message to Responsible Party"', () => {
  const el = new CRConversation();
  el._messages = [];
  el.connectedCallback();

  // children: heading, empty/list, compose
  const compose = /** @type {any} */ (el)._children[2];
  const textarea = compose._children[0];
  assert.equal(textarea._attrs['aria-label'], 'Message to Responsible Party');
});

test('CRConversation: send button has aria-label even when textarea is empty', () => {
  const el = new CRConversation();
  el._messages = [];
  el.connectedCallback();

  const compose = /** @type {any} */ (el)._children[2];
  const btn = compose._children[1];
  assert.equal(btn.textContent, 'Send');
});

// ---- status banner regression ----

test('CRStatusBanner: saving banner has role=status and polite', () => {
  const s = signal(/** @type {'saving'} */ ('saving'));
  const el = new CRStatusBanner();
  el.saveQueue = /** @type {any} */ ({ status: s });
  el.connectedCallback();
  const node = /** @type {any} */ (el)._children[0];
  assert.equal(node._attrs['role'], 'status');
  assert.equal(node._attrs['aria-live'], 'polite');
});
