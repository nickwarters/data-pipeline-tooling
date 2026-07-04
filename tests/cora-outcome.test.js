// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

// DOM stubs must be in place before any src import

const { CORAOutcome, Outcome } = await import('../src/components/cora-outcome.js');

/** @param {Record<string, import('../src/sharepoint-client.js').Answer>} answers */
function makeComputeOutcome(answers) {
  const hasNo = Object.values(answers).some((a) => a.value === 'No');
  return { outcome: /** @type {'pass' | 'fail'} */ (hasNo ? 'fail' : 'pass') };
}

test('Outcome: plain function renders heading and indeterminate state', () => {
  const nodes = Outcome({
    computeOutcome: null,
    answers: {},
    allAnswered: false,
  });

  assert.equal(/** @type {any} */ (nodes[0]).textContent, 'Outcome');
  assert.equal(
    /** @type {any} */ (nodes[1]).className,
    'cora-outcome-indeterminate'
  );
});

test('CORAOutcome: renders h2 Outcome heading', () => {
  const el = new CORAOutcome();
  el.connectedCallback();

  const h2 = /** @type {any} */ (el)._children[0];
  assert.equal(h2.textContent, 'Outcome');
});

test('CORAOutcome: shows indeterminate state on initial render (no update called)', () => {
  const el = new CORAOutcome();
  el.connectedCallback();

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cora-outcome-indeterminate');
  assert.equal(outcome.textContent, 'Awaiting answers…');
});

test('CORAOutcome: shows indeterminate state when allAnswered is false', () => {
  const el = new CORAOutcome();
  el.connectedCallback();
  el.update(() => ({ outcome: 'pass' }), {}, false);

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cora-outcome-indeterminate');
  assert.equal(outcome.textContent, 'Awaiting answers…');
});

test('CORAOutcome: shows pass outcome when allAnswered is true and no No answers', () => {
  const answers = {
    'q-welcome': { value: 'Yes' },
    'q-needs': { value: 'N/A' },
  };
  const el = new CORAOutcome();
  el.connectedCallback();
  el.update((a) => makeComputeOutcome(a), answers, true);

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cora-outcome-pass');
  assert.equal(outcome.textContent, 'Pass');
});

test('CORAOutcome: shows fail outcome when allAnswered is true and any answer is No', () => {
  const answers = { 'q-welcome': { value: 'Yes' }, 'q-needs': { value: 'No' } };
  const el = new CORAOutcome();
  el.connectedCallback();
  el.update((a) => makeComputeOutcome(a), answers, true);

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cora-outcome-fail');
  assert.equal(outcome.textContent, 'Fail');
});

test('CORAOutcome: renders configured wording while styling by outcome id', () => {
  const el = new CORAOutcome();
  el.connectedCallback();
  el.update(
    () => ({ outcome: 'pass', wording: 'Pass with feedback' }),
    {},
    true
  );

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cora-outcome-pass');
  assert.equal(outcome.textContent, 'Pass with feedback');
});

test('CORAOutcome: supports refer fallback wording', () => {
  const el = new CORAOutcome();
  el.connectedCallback();
  el.update(() => ({ outcome: 'refer' }), {}, true);

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cora-outcome-refer');
  assert.equal(outcome.textContent, 'Refer');
});

test('CORAOutcome: updates outcome reactively when update() is called again', () => {
  const el = new CORAOutcome();
  el.connectedCallback();

  const passingAnswers = { 'q-welcome': { value: 'Yes' } };
  el.update((a) => makeComputeOutcome(a), passingAnswers, true);
  assert.equal(
    /** @type {any} */ (el)._children[1].className,
    'cora-outcome-pass'
  );

  const failingAnswers = { 'q-welcome': { value: 'No' } };
  el.update((a) => makeComputeOutcome(a), failingAnswers, true);
  assert.equal(
    /** @type {any} */ (el)._children[1].className,
    'cora-outcome-fail'
  );
});

test('CORAOutcome: transitions from indeterminate to pass when all questions answered', () => {
  const el = new CORAOutcome();
  el.connectedCallback();

  el.update(() => ({ outcome: 'pass' }), {}, false);
  assert.equal(
    /** @type {any} */ (el)._children[1].className,
    'cora-outcome-indeterminate'
  );

  el.update(
    () => ({ outcome: 'pass' }),
    { 'q-welcome': { value: 'Yes' } },
    true
  );
  assert.equal(
    /** @type {any} */ (el)._children[1].className,
    'cora-outcome-pass'
  );
});

test('CORAOutcome: always renders exactly two children (h2 + outcome p)', () => {
  const el = new CORAOutcome();
  el.connectedCallback();
  assert.equal(/** @type {any} */ (el)._children.length, 2);

  el.update(() => ({ outcome: 'fail' }), { 'q-x': { value: 'No' } }, true);
  assert.equal(/** @type {any} */ (el)._children.length, 2);
});
