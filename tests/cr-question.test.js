// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ===== MINIMAL DOM STUBS =====

class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    this.textContent = '';
    this.className = '';
    this.type = '';
    this.name = '';
    this.value = '';
    this.checked = false;
    /** @type {string} */
    this._tagName = '';
    this.open = false;
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) { this._children = cs; }
  appendChild(/** @type {StubEl} */ c) { this._children.push(c); return c; }
  append(/** @type {StubEl[]} */ ...cs) { this._children.push(...cs); }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) { (/** @type {any} */ (this))._attrs ??= {}; (/** @type {any} */ (this))._attrs[k] = v; }
  getAttribute(/** @type {string} */ k) { return (/** @type {any} */ (this))._attrs?.[k] ?? null; }
  /** @param {{ detail?: unknown, bubbles?: boolean }} ev */
  dispatchEvent(ev) {
    /** @type {any} */ (this)._lastDispatched = ev;
    return true;
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
  /** @param {string} tag @returns {StubEl} */
  createElement(tag) {
    const el = new StubEl();
    el._tagName = tag;
    return el;
  },
};
(/** @type {any} */ (globalThis)).customElements = { define() {} };
(/** @type {any} */ (globalThis)).CustomEvent = StubCustomEvent;

// ===== IMPORTS (after stubs) =====
const { CRQuestion } = await import('../src/cr-question.js');

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

// ===== HELPERS =====

/**
 * Walks a stub tree and returns all descendant inputs (StubEls with non-empty .type).
 * @param {any} root
 * @returns {any[]}
 */
function findInputs(root) {
  /** @type {any[]} */
  const out = [];
  function walk(/** @type {any} */ node) {
    for (const c of node._children ?? []) {
      if (c.type === 'radio' || c.type === 'checkbox') out.push(c);
      walk(c);
    }
  }
  walk(root);
  return out;
}

// ===== yes-no-na (regression) =====

test('CRQuestion: yes-no-na renders 3 radios', () => {
  /** @type {QuestionDefinition} */
  const qd = { id: 'q1', text: 'q1?', responseType: 'yes-no-na', deprecated: false };
  const el = new CRQuestion();
  el.question = qd;
  el.connectedCallback();

  const inputs = findInputs(el);
  assert.equal(inputs.length, 3);
  assert.ok(inputs.every(i => i.type === 'radio'));
  assert.deepEqual(inputs.map(i => i.value), ['Yes', 'No', 'NA']);
});

// ===== single-choice =====

test('CRQuestion: single-choice renders one radio per option from QuestionDefinition.options', () => {
  /** @type {QuestionDefinition} */
  const qd = {
    id: 'q-channel',
    text: 'Which channel?',
    responseType: 'single-choice',
    options: ['Phone', 'Email', 'Chat'],
    deprecated: false,
  };
  const el = new CRQuestion();
  el.question = qd;
  el.connectedCallback();

  const inputs = findInputs(el);
  assert.equal(inputs.length, 3);
  assert.ok(inputs.every(i => i.type === 'radio'));
  assert.deepEqual(inputs.map(i => i.value), ['Phone', 'Email', 'Chat']);
});

test('CRQuestion: single-choice marks current value as checked', () => {
  /** @type {QuestionDefinition} */
  const qd = {
    id: 'q-channel',
    text: 'Which channel?',
    responseType: 'single-choice',
    options: ['Phone', 'Email'],
    deprecated: false,
  };
  const el = new CRQuestion();
  el.question = qd;
  el.currentValue = 'Email';
  el.connectedCallback();

  const inputs = findInputs(el);
  assert.equal(inputs.find(i => i.value === 'Phone').checked, false);
  assert.equal(inputs.find(i => i.value === 'Email').checked, true);
});

test('CRQuestion: single-choice change dispatches cr-answer with string value', () => {
  /** @type {QuestionDefinition} */
  const qd = {
    id: 'q-channel',
    text: 'Which channel?',
    responseType: 'single-choice',
    options: ['Phone', 'Email'],
    deprecated: false,
  };
  const el = new CRQuestion();
  el.question = qd;
  el.connectedCallback();

  const phone = findInputs(el).find(i => i.value === 'Phone');
  // Simulate user selecting Phone.
  phone.checked = true;
  phone._listeners['change'][0]();

  const ev = (/** @type {any} */ (el))._lastDispatched;
  assert.equal(ev.type, 'cr-answer');
  assert.deepEqual(ev.detail, { questionId: 'q-channel', value: 'Phone' });
});

// ===== multi-choice =====

test('CRQuestion: multi-choice renders one checkbox per option', () => {
  /** @type {QuestionDefinition} */
  const qd = {
    id: 'q-chan',
    text: 'Which channels?',
    responseType: 'multi-choice',
    options: ['Phone', 'Email', 'Chat'],
    deprecated: false,
  };
  const el = new CRQuestion();
  el.question = qd;
  el.connectedCallback();

  const inputs = findInputs(el);
  assert.equal(inputs.length, 3);
  assert.ok(inputs.every(i => i.type === 'checkbox'));
  assert.deepEqual(inputs.map(i => i.value), ['Phone', 'Email', 'Chat']);
});

test('CRQuestion: multi-choice marks each currentValue array element as checked', () => {
  /** @type {QuestionDefinition} */
  const qd = {
    id: 'q-chan',
    text: 'Which channels?',
    responseType: 'multi-choice',
    options: ['Phone', 'Email', 'Chat'],
    deprecated: false,
  };
  const el = new CRQuestion();
  el.question = qd;
  el.currentValue = ['Phone', 'Chat'];
  el.connectedCallback();

  const inputs = findInputs(el);
  assert.equal(inputs.find(i => i.value === 'Phone').checked, true);
  assert.equal(inputs.find(i => i.value === 'Email').checked, false);
  assert.equal(inputs.find(i => i.value === 'Chat').checked, true);
});

test('CRQuestion: multi-choice selecting an option dispatches cr-answer with array', () => {
  /** @type {QuestionDefinition} */
  const qd = {
    id: 'q-chan',
    text: 'Which channels?',
    responseType: 'multi-choice',
    options: ['Phone', 'Email', 'Chat'],
    deprecated: false,
  };
  const el = new CRQuestion();
  el.question = qd;
  el.currentValue = [];
  el.connectedCallback();

  const phone = findInputs(el).find(i => i.value === 'Phone');
  phone.checked = true;
  phone._listeners['change'][0]();

  const ev = (/** @type {any} */ (el))._lastDispatched;
  assert.equal(ev.type, 'cr-answer');
  assert.deepEqual(ev.detail, { questionId: 'q-chan', value: ['Phone'] });
});

test('CRQuestion: multi-choice selecting another option appends to existing array', () => {
  /** @type {QuestionDefinition} */
  const qd = {
    id: 'q-chan',
    text: 'Which channels?',
    responseType: 'multi-choice',
    options: ['Phone', 'Email', 'Chat'],
    deprecated: false,
  };
  const el = new CRQuestion();
  el.question = qd;
  el.currentValue = ['Phone'];
  el.connectedCallback();

  const email = findInputs(el).find(i => i.value === 'Email');
  email.checked = true;
  email._listeners['change'][0]();

  const ev = (/** @type {any} */ (el))._lastDispatched;
  assert.deepEqual(ev.detail, { questionId: 'q-chan', value: ['Phone', 'Email'] });
});

test('CRQuestion: multi-choice deselecting an option removes it from the array', () => {
  /** @type {QuestionDefinition} */
  const qd = {
    id: 'q-chan',
    text: 'Which channels?',
    responseType: 'multi-choice',
    options: ['Phone', 'Email', 'Chat'],
    deprecated: false,
  };
  const el = new CRQuestion();
  el.question = qd;
  el.currentValue = ['Phone', 'Email'];
  el.connectedCallback();

  const email = findInputs(el).find(i => i.value === 'Email');
  email.checked = false;
  email._listeners['change'][0]();

  const ev = (/** @type {any} */ (el))._lastDispatched;
  assert.deepEqual(ev.detail, { questionId: 'q-chan', value: ['Phone'] });
});

// ===== Remediation Actions panel =====

/**
 * Walks a stub tree and returns the first descendant element with the given className.
 * @param {any} root
 * @param {string} cls
 * @returns {any}
 */
function findByClass(root, cls) {
  for (const c of root._children ?? []) {
    if (c.className === cls) return c;
    const nested = findByClass(c, cls);
    if (nested) return nested;
  }
  return null;
}

test('CRQuestion: failed yes-no-na answer with remediationActions renders Actions required panel', () => {
  /** @type {QuestionDefinition} */
  const qd = {
    id: 'q-needs',
    text: 'Needs identified?',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    remediationActions: ['Retrain agent.', 'Update script.'],
    deprecated: false,
  };
  const el = new CRQuestion();
  el.question = qd;
  el.currentValue = 'No';
  el.connectedCallback();

  const panel = findByClass(el, 'cr-remediation-panel');
  assert.ok(panel, 'panel should be rendered');
  // panel has [summary, ul]; ul has one li per action
  const ul = panel._children.find((/** @type {any} */ c) => c._tagName === 'ul');
  assert.equal(ul._children.length, 2);
  assert.deepEqual(ul._children.map((/** @type {any} */ li) => li.textContent), [
    'Retrain agent.',
    'Update script.',
  ]);
});

test('CRQuestion: passing answer does not render Actions required panel', () => {
  /** @type {QuestionDefinition} */
  const qd = {
    id: 'q-needs',
    text: 'Needs identified?',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    remediationActions: ['Retrain agent.'],
    deprecated: false,
  };
  const el = new CRQuestion();
  el.question = qd;
  el.currentValue = 'Yes';
  el.connectedCallback();

  assert.equal(findByClass(el, 'cr-remediation-panel'), null);
});

test('CRQuestion: failed answer without remediationActions renders no panel', () => {
  /** @type {QuestionDefinition} */
  const qd = {
    id: 'q-welcome',
    text: 'Greeted professionally?',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    deprecated: false,
  };
  const el = new CRQuestion();
  el.question = qd;
  el.currentValue = 'No';
  el.connectedCallback();

  assert.equal(findByClass(el, 'cr-remediation-panel'), null);
});

test('CRQuestion: multi-choice answer including failureCriteria renders panel', () => {
  /** @type {QuestionDefinition} */
  const qd = {
    id: 'q-products',
    text: 'Products discussed?',
    responseType: 'multi-choice',
    options: ['Account', 'Billing', 'Support'],
    failureCriteria: 'Billing',
    remediationActions: ['Refer to billing team.'],
    deprecated: false,
  };
  const el = new CRQuestion();
  el.question = qd;
  el.currentValue = ['Account', 'Billing'];
  el.connectedCallback();

  assert.ok(findByClass(el, 'cr-remediation-panel'));
});

test('CRQuestion: multi-choice answer not including failureCriteria does not render panel', () => {
  /** @type {QuestionDefinition} */
  const qd = {
    id: 'q-products',
    text: 'Products discussed?',
    responseType: 'multi-choice',
    options: ['Account', 'Billing', 'Support'],
    failureCriteria: 'Billing',
    remediationActions: ['Refer to billing team.'],
    deprecated: false,
  };
  const el = new CRQuestion();
  el.question = qd;
  el.currentValue = ['Account', 'Support'];
  el.connectedCallback();

  assert.equal(findByClass(el, 'cr-remediation-panel'), null);
});

test('CRQuestion: multi-choice deselecting last option dispatches empty array', () => {
  /** @type {QuestionDefinition} */
  const qd = {
    id: 'q-chan',
    text: 'Which channels?',
    responseType: 'multi-choice',
    options: ['Phone', 'Email'],
    deprecated: false,
  };
  const el = new CRQuestion();
  el.question = qd;
  el.currentValue = ['Phone'];
  el.connectedCallback();

  const phone = findInputs(el).find(i => i.value === 'Phone');
  phone.checked = false;
  phone._listeners['change'][0]();

  const ev = (/** @type {any} */ (el))._lastDispatched;
  assert.deepEqual(ev.detail, { questionId: 'q-chan', value: [] });
});

test('CRQuestion: focus() forwards to the first input element', () => {
  /** @type {QuestionDefinition} */
  const qd = { id: 'q-focus', text: 'Focus test?', responseType: 'yes-no-na', deprecated: false };
  const el = new CRQuestion();
  el.question = qd;
  el.connectedCallback();

  let focusCalled = false;
  const mockInput = { focus() { focusCalled = true; } };
  /** @type {any} */ (el).querySelector = () => mockInput;

  el.focus();
  assert.equal(focusCalled, true);
});

test('CRQuestion: focus() is a no-op when querySelector returns null', () => {
  /** @type {QuestionDefinition} */
  const qd = { id: 'q-focus2', text: 'Focus null?', responseType: 'yes-no-na', deprecated: false };
  const el = new CRQuestion();
  el.question = qd;
  el.connectedCallback();

  /** @type {any} */ (el).querySelector = () => null;
  assert.doesNotThrow(() => el.focus());
});
