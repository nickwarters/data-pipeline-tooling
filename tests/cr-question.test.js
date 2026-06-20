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
    /** @type {Record<string, string>} */
    this._attrs = {};
    this.textContent = '';
    this.className = '';
    this.id = '';
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
  /** @param {string} _sel @returns {StubEl | null} */
  querySelector(_sel) {
    // Very simple find for 'input'
    for (const c of this._children) {
      if (c._children.length > 0) {
        const found = c.querySelector(_sel);
        if (found) return found;
      }
      if (_sel === 'input') return this; // This is a hack for the focus test
    }
    return null;
  }
  focus() {
    /** @type {any} */ (globalThis)._lastFocused = this;
  }
}

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).document = {
  /** @param {string} _tag @returns {StubEl} */
  createElement(_tag) {
    return new StubEl();
  },
};
/** @type {any} */ (globalThis).customElements = { define() {} };

// ===== IMPORTS =====
const { CRQuestion } = await import('../src/components/cr-question.js');

// ===== TESTS =====

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
const Q_YES_NO = /** @type {QuestionDefinition} */ ({
  id: 'q1',
  text: 'Q1?',
  responseType: 'yes-no-na',
  deprecated: false,
});

const Q_MULTI = /** @type {QuestionDefinition} */ ({
  id: 'q2',
  text: 'Q2?',
  responseType: 'multi-choice',
  options: ['A', 'B'],
  deprecated: false,
});

test('CRQuestion: renders nothing if question is missing', () => {
  const el = new CRQuestion();
  el.connectedCallback();
  assert.equal(/** @type {any} */ (el)._children.length, 0);
});

test('CRQuestion: renders yes-no-na options', () => {
  const el = new CRQuestion();
  el.question = Q_YES_NO;
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  assert.equal(fieldset.className, 'cr-question');
  // legend + 3 labels
  assert.equal(fieldset._children.length, 4);
});

test('CRQuestion: renders multi-choice options', () => {
  const el = new CRQuestion();
  el.question = Q_MULTI;
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  assert.equal(fieldset.getAttribute('role'), 'group');
  // legend + 2 labels
  assert.equal(fieldset._children.length, 3);
});

test('CRQuestion: single-choice radio change dispatches event', () => {
  const el = new CRQuestion();
  el.question = Q_YES_NO;
  el.connectedCallback();

  /** @type {any[]} */
  const events = [];
  el.dispatchEvent = (e) => {
    events.push(e);
    return true;
  };

  const fieldset = /** @type {any} */ (el)._children[0];
  const firstLabel = fieldset._children[1];
  const radio = firstLabel._children[0];

  radio._listeners['change'][0]();

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'cr-answer');
  assert.equal(events[0].detail.value, 'Yes');
});

test('CRQuestion: multi-choice change handler exercises both checked branches', () => {
  const el = new CRQuestion();
  el.question = Q_MULTI;
  el.currentValue = [];
  el.connectedCallback();

  /** @type {any[]} */
  const events = [];
  el.dispatchEvent = (e) => {
    events.push(e);
    return true;
  };

  const fieldset = /** @type {any} */ (el)._children[0];
  const firstLabel = fieldset._children[1];
  const checkbox = firstLabel._children[0];

  // Branch: checkbox.checked = true
  checkbox.checked = true;
  checkbox._listeners['change'][0]({ target: checkbox });
  assert.deepEqual(events[0].detail.value, ['A']);

  // Branch: checkbox.checked = false
  // We need to re-render or update state to simulate the next state where 'A' is selected
  el.currentValue = ['A'];
  el._render();
  const nextFieldset = /** @type {any} */ (el)._children[0];
  const nextCheckbox = nextFieldset._children[1]._children[0];
  nextCheckbox.checked = false;
  nextCheckbox._listeners['change'][0]({ target: nextCheckbox });
  assert.deepEqual(events[1].detail.value, []);
});

test('CRQuestion: read-only access disables inputs', () => {
  const el = new CRQuestion();
  el.question = Q_YES_NO;
  el.access = 'read-only';
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  const radio = fieldset._children[1]._children[0];
  assert.equal(radio.disabled, true);

  /** @type {any[]} */
  const events = [];
  el.dispatchEvent = (e) => {
    events.push(e);
    return true;
  };
  radio._listeners['change'][0]();
  assert.equal(events.length, 0);
});

test('CRQuestion: multi-choice read-only access ignores changes', () => {
  const el = new CRQuestion();
  el.question = Q_MULTI;
  el.access = 'read-only';
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  const checkbox = fieldset._children[1]._children[0];

  /** @type {any[]} */
  const events = [];
  el.dispatchEvent = (e) => {
    events.push(e);
    return true;
  };
  checkbox._listeners['change'][0]();
  assert.equal(events.length, 0);
});

test('CRQuestion: renders remediation panel for failure', () => {
  const q = {
    ...Q_YES_NO,
    remediationActions: ['Action 1'],
    failureCriteria: 'No',
  };
  const el = new CRQuestion();
  el.question = q;
  el.currentValue = 'No';
  el.connectedCallback();

  // children: [fieldset, details]
  assert.equal(/** @type {any} */ (el)._children.length, 2);
  const panel = /** @type {any} */ (el)._children[1];
  assert.equal(panel.className, 'cr-remediation-panel');
});

test('CRQuestion: renders single-choice with custom options', () => {
  const el = new CRQuestion();
  el.question = {
    ...Q_YES_NO,
    responseType: 'single-choice',
    options: ['Maybe'],
  };
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  assert.equal(fieldset.getAttribute('role'), 'radiogroup');
  // legend + 1 label
  assert.equal(fieldset._children.length, 2);
  // label text is in the second child (span) of the label
  const label = fieldset._children[1];
  const span = label._children[1];
  assert.equal(span.textContent, ' Maybe');
});

test('CRQuestion: does not render remediation panel if no actions', () => {
  const el = new CRQuestion();
  el.question = { ...Q_YES_NO, remediationActions: [] };
  el.connectedCallback();
  assert.equal(/** @type {any} */ (el)._children.length, 1);
});

test('CRQuestion: does not render remediation panel if not a failure', () => {
  const el = new CRQuestion();
  el.question = {
    ...Q_YES_NO,
    remediationActions: ['Act'],
    failureCriteria: 'No',
  };
  el.currentValue = 'Yes';
  el.connectedCallback();
  assert.equal(/** @type {any} */ (el)._children.length, 1);
});

test('CRQuestion: _renderSingleChoice handles non-string currentValue', () => {
  const el = new CRQuestion();
  el.question = Q_YES_NO;
  // @ts-ignore
  el.currentValue = null;
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  const radio = fieldset._children[1]._children[0];
  assert.equal(radio.checked, false);
});

test('CRQuestion: _renderSingleChoice handles array currentValue', () => {
  const el = new CRQuestion();
  el.question = Q_YES_NO;
  // @ts-ignore
  el.currentValue = ['Yes'];
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  const radio = fieldset._children[1]._children[0];
  assert.equal(radio.checked, false);
});

test('CRQuestion: _renderMultiChoice handles missing options', () => {
  const el = new CRQuestion();
  el.question = { ...Q_MULTI, options: undefined };
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  // legend only
  assert.equal(fieldset._children.length, 1);
});

test('CRQuestion: _renderMultiChoice handles non-array currentValue', () => {
  const el = new CRQuestion();
  el.question = Q_MULTI;
  // @ts-ignore
  el.currentValue = 'A';
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  const firstLabel = fieldset._children[1];
  const checkbox = firstLabel._children[0];
  // selected Set will be empty because 'A' is not an array, so checkbox should be unchecked
  assert.equal(checkbox.checked, false);
});

test('CRQuestion: focus() forwards to input', () => {
  const el = new CRQuestion();
  el.question = Q_YES_NO;
  el.connectedCallback();

  // Create a mock input that we can find
  const fieldset = /** @type {any} */ (el)._children[0];
  const firstLabel = fieldset._children[1];
  const radio = firstLabel._children[0];

  // Override querySelector to return our radio
  el.querySelector = () => /** @type {any} */ (radio);

  /** @type {any} */ (globalThis)._lastFocused = null;
  el.focus();
  assert.equal(/** @type {any} */ (globalThis)._lastFocused, radio);
});

test('CRQuestion: focus() does nothing if no input found', () => {
  const el = new CRQuestion();
  el.question = Q_YES_NO;
  el.connectedCallback();

  // Override querySelector to return null
  el.querySelector = () => null;

  /** @type {any} */ (globalThis)._lastFocused = 'initial';
  el.focus();
  assert.equal(/** @type {any} */ (globalThis)._lastFocused, 'initial');
});

test('CRQuestion: single-choice with no options renders empty fieldset (covers q.options ?? [])', () => {
  const el = new CRQuestion();
  el.question = {
    .../** @type {any} */ (Q_YES_NO),
    responseType: 'single-choice',
    options: undefined,
  };
  el.connectedCallback();
  // With options: undefined, falls back to [], so fieldset has only the legend (no label children)
  const fieldset = /** @type {any} */ (el)._children[0];
  // Only the legend child; no radio labels added
  assert.equal(
    fieldset._children.length,
    1,
    'undefined options falls back to [] → only legend in fieldset'
  );
});
