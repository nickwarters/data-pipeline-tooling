// @ts-check
// TODO(simplify-ui): Rewrite these lifecycle-heavy tests around the
// future function-component API. Prefer asserting plain functions, h() output,
// reactive() updates, and route-shell behavior over manual connectedCallback()/
// disconnectedCallback() calls on custom element classes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// DOM stubs must be in place before any src import
class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    this.textContent = '';
    this.className = '';
    this.hidden = false;
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

const { CROutcome } = await import('../src/components/cr-outcome.js');

/** @param {Record<string, import('../src/sharepoint-client.js').Answer>} answers */
function makeComputeOutcome(answers) {
  const hasNo = Object.values(answers).some((a) => a.value === 'No');
  return { outcome: /** @type {'pass' | 'fail'} */ (hasNo ? 'fail' : 'pass') };
}

test('CROutcome: renders h2 Outcome heading', () => {
  const el = new CROutcome();
  el.connectedCallback();

  const h2 = /** @type {any} */ (el)._children[0];
  assert.equal(h2.textContent, 'Outcome');
});

test('CROutcome: shows indeterminate state on initial render (no update called)', () => {
  const el = new CROutcome();
  el.connectedCallback();

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cr-outcome-indeterminate');
  assert.equal(outcome.textContent, 'Awaiting answers…');
});

test('CROutcome: shows indeterminate state when allAnswered is false', () => {
  const el = new CROutcome();
  el.connectedCallback();
  el.update(() => ({ outcome: 'pass' }), {}, false);

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cr-outcome-indeterminate');
  assert.equal(outcome.textContent, 'Awaiting answers…');
});

test('CROutcome: shows pass outcome when allAnswered is true and no No answers', () => {
  const answers = {
    'q-welcome': { value: 'Yes' },
    'q-needs': { value: 'N/A' },
  };
  const el = new CROutcome();
  el.connectedCallback();
  el.update((a) => makeComputeOutcome(a), answers, true);

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cr-outcome-pass');
  assert.equal(outcome.textContent, 'Pass');
});

test('CROutcome: shows fail outcome when allAnswered is true and any answer is No', () => {
  const answers = { 'q-welcome': { value: 'Yes' }, 'q-needs': { value: 'No' } };
  const el = new CROutcome();
  el.connectedCallback();
  el.update((a) => makeComputeOutcome(a), answers, true);

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cr-outcome-fail');
  assert.equal(outcome.textContent, 'Fail');
});

test('CROutcome: renders configured wording while styling by outcome id', () => {
  const el = new CROutcome();
  el.connectedCallback();
  el.update(
    () => ({ outcome: 'pass', wording: 'Pass with feedback' }),
    {},
    true
  );

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cr-outcome-pass');
  assert.equal(outcome.textContent, 'Pass with feedback');
});

test('CROutcome: supports refer fallback wording', () => {
  const el = new CROutcome();
  el.connectedCallback();
  el.update(() => ({ outcome: 'refer' }), {}, true);

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cr-outcome-refer');
  assert.equal(outcome.textContent, 'Refer');
});

test('CROutcome: updates outcome reactively when update() is called again', () => {
  const el = new CROutcome();
  el.connectedCallback();

  const passingAnswers = { 'q-welcome': { value: 'Yes' } };
  el.update((a) => makeComputeOutcome(a), passingAnswers, true);
  assert.equal(
    /** @type {any} */ (el)._children[1].className,
    'cr-outcome-pass'
  );

  const failingAnswers = { 'q-welcome': { value: 'No' } };
  el.update((a) => makeComputeOutcome(a), failingAnswers, true);
  assert.equal(
    /** @type {any} */ (el)._children[1].className,
    'cr-outcome-fail'
  );
});

test('CROutcome: transitions from indeterminate to pass when all questions answered', () => {
  const el = new CROutcome();
  el.connectedCallback();

  el.update(() => ({ outcome: 'pass' }), {}, false);
  assert.equal(
    /** @type {any} */ (el)._children[1].className,
    'cr-outcome-indeterminate'
  );

  el.update(
    () => ({ outcome: 'pass' }),
    { 'q-welcome': { value: 'Yes' } },
    true
  );
  assert.equal(
    /** @type {any} */ (el)._children[1].className,
    'cr-outcome-pass'
  );
});

test('CROutcome: always renders exactly two children (h2 + outcome p)', () => {
  const el = new CROutcome();
  el.connectedCallback();
  assert.equal(/** @type {any} */ (el)._children.length, 2);

  el.update(() => ({ outcome: 'fail' }), { 'q-x': { value: 'No' } }, true);
  assert.equal(/** @type {any} */ (el)._children.length, 2);
});
