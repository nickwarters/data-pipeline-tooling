// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

// DOM stubs must be in place before any src import

const { CORAOutcome, Outcome } =
  await import('../src/components/sections/cora-outcome.js');

/** @type {import('../src/sharepoint-client.js').OutcomeOption[]} */
const OUTCOME_OPTIONS = [
  { id: 'pass', wording: 'Pass', severity: 0 },
  { id: 'refer', wording: 'Refer', severity: 50 },
  { id: 'fail', wording: 'Fail', severity: 100 },
];

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
    outcomeOptions: OUTCOME_OPTIONS,
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
  el.update({
    computeOutcome: () => ({ outcome: 'pass' }),
    answers: {},
    allAnswered: false,
    outcomeOptions: OUTCOME_OPTIONS,
  });

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
  el.update({
    computeOutcome: (a) => makeComputeOutcome(a),
    answers,
    allAnswered: true,
    outcomeOptions: OUTCOME_OPTIONS,
  });

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cora-outcome-pass');
  assert.equal(outcome.textContent, 'Pass');
});

test('CORAOutcome: shows fail outcome when allAnswered is true and any answer is No', () => {
  const answers = { 'q-welcome': { value: 'Yes' }, 'q-needs': { value: 'No' } };
  const el = new CORAOutcome();
  el.connectedCallback();
  el.update({
    computeOutcome: (a) => makeComputeOutcome(a),
    answers,
    allAnswered: true,
    outcomeOptions: OUTCOME_OPTIONS,
  });

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cora-outcome-fail');
  assert.equal(outcome.textContent, 'Fail');
});

test('CORAOutcome: renders the configured wording for the outcome id', () => {
  const el = new CORAOutcome();
  el.connectedCallback();
  el.update({
    computeOutcome: () => ({ outcome: 'pass' }),
    answers: {},
    allAnswered: true,
    outcomeOptions: [
      { id: 'pass', wording: 'Pass with feedback', severity: 0 },
    ],
  });

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cora-outcome-pass');
  assert.equal(outcome.textContent, 'Pass with feedback');
});

test('CORAOutcome: resolves wording from config, ignoring any wording on the result', () => {
  const el = new CORAOutcome();
  el.connectedCallback();
  // The result carries a stray wording; the configured option is authoritative.
  el.update({
    computeOutcome: () => ({ outcome: 'pass', wording: 'Stray wording' }),
    answers: {},
    allAnswered: true,
    outcomeOptions: [{ id: 'pass', wording: 'Compliant', severity: 0 }],
  });

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cora-outcome-pass');
  assert.equal(outcome.textContent, 'Compliant');
});

test('CORAOutcome: shows a "not configured" state when the outcome id has no configured option', () => {
  const el = new CORAOutcome();
  el.connectedCallback();
  el.update({
    computeOutcome: () => ({ outcome: 'refer' }),
    answers: {},
    allAnswered: true,
    outcomeOptions: [
      { id: 'pass', wording: 'Pass', severity: 0 },
      { id: 'fail', wording: 'Fail', severity: 100 },
    ],
  });

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cora-outcome-indeterminate');
  assert.equal(outcome.textContent, 'Outcome not configured');
});

test('CORAOutcome: shows a "not configured" state when no outcomeOptions are supplied', () => {
  const el = new CORAOutcome();
  el.connectedCallback();
  el.update({
    computeOutcome: () => ({ outcome: 'pass' }),
    answers: {},
    allAnswered: true,
  });

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cora-outcome-indeterminate');
  assert.equal(outcome.textContent, 'Outcome not configured');
});

test('CORAOutcome: supports configured refer wording', () => {
  const el = new CORAOutcome();
  el.connectedCallback();
  el.update({
    computeOutcome: () => ({ outcome: 'refer' }),
    answers: {},
    allAnswered: true,
    outcomeOptions: OUTCOME_OPTIONS,
  });

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cora-outcome-refer');
  assert.equal(outcome.textContent, 'Refer');
});

test('CORAOutcome: updates outcome reactively when update() is called again', () => {
  const el = new CORAOutcome();
  el.connectedCallback();

  const passingAnswers = { 'q-welcome': { value: 'Yes' } };
  el.update({
    computeOutcome: (a) => makeComputeOutcome(a),
    answers: passingAnswers,
    allAnswered: true,
    outcomeOptions: OUTCOME_OPTIONS,
  });
  assert.equal(
    /** @type {any} */ (el)._children[1].className,
    'cora-outcome-pass'
  );

  const failingAnswers = { 'q-welcome': { value: 'No' } };
  el.update({
    computeOutcome: (a) => makeComputeOutcome(a),
    answers: failingAnswers,
    allAnswered: true,
    outcomeOptions: OUTCOME_OPTIONS,
  });
  assert.equal(
    /** @type {any} */ (el)._children[1].className,
    'cora-outcome-fail'
  );
});

test('CORAOutcome: transitions from indeterminate to pass when all questions answered', () => {
  const el = new CORAOutcome();
  el.connectedCallback();

  el.update({
    computeOutcome: () => ({ outcome: 'pass' }),
    answers: {},
    allAnswered: false,
    outcomeOptions: OUTCOME_OPTIONS,
  });
  assert.equal(
    /** @type {any} */ (el)._children[1].className,
    'cora-outcome-indeterminate'
  );

  el.update({
    computeOutcome: () => ({ outcome: 'pass' }),
    answers: { 'q-welcome': { value: 'Yes' } },
    allAnswered: true,
    outcomeOptions: OUTCOME_OPTIONS,
  });
  assert.equal(
    /** @type {any} */ (el)._children[1].className,
    'cora-outcome-pass'
  );
});

test('CORAOutcome: update() renders immediately even when the element was never connected (fresh host, as cora-summary creates it)', () => {
  const el = new CORAOutcome();
  el.update({
    computeOutcome: () => ({ outcome: 'pass' }),
    answers: {},
    allAnswered: true,
    outcomeOptions: OUTCOME_OPTIONS,
  });

  const outcome = /** @type {any} */ (el)._children[1];
  assert.equal(outcome.className, 'cora-outcome-pass');
  assert.equal(outcome.textContent, 'Pass');
});

test('CORAOutcome: always renders exactly two children (h2 + outcome p)', () => {
  const el = new CORAOutcome();
  el.connectedCallback();
  assert.equal(/** @type {any} */ (el)._children.length, 2);

  el.update({
    computeOutcome: () => ({ outcome: 'fail' }),
    answers: { 'q-x': { value: 'No' } },
    allAnswered: true,
    outcomeOptions: OUTCOME_OPTIONS,
  });
  assert.equal(/** @type {any} */ (el)._children.length, 2);
});
