// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findByClass, installDom } from './_dom-stub.js';

installDom();

const { Outcome } =
  await import('../src/pages/cora-case-review/outcome-view.js');

/** @type {import('../src/sharepoint-client.js').OutcomeOption[]} */
const OPTIONS = [
  { id: 'pass', wording: 'Compliant', severity: 0 },
  { id: 'refer', wording: 'Refer for review', severity: 50 },
  { id: 'fail', wording: 'Non-compliant', severity: 100 },
];

test('Outcome waits until all answers and an evaluator are available', () => {
  for (const props of [
    { computeOutcome: null, allAnswered: true },
    { computeOutcome: () => ({ outcome: 'pass' }), allAnswered: false },
  ]) {
    const nodes = Outcome({
      ...props,
      answers: {},
      outcomeOptions: OPTIONS,
    });
    assert.equal(nodes[0].textContent, 'Outcome');
    assert.equal(nodes[1].textContent, 'Awaiting answers…');
    assert.equal(
      /** @type {HTMLElement} */ (nodes[1]).className,
      'cora-outcome-indeterminate'
    );
  }
});

test('Outcome renders wording only from the configured option', () => {
  const nodes = Outcome({
    computeOutcome: () => ({ outcome: 'pass', wording: 'Untrusted wording' }),
    answers: { q1: { value: 'Yes' } },
    allAnswered: true,
    outcomeOptions: OPTIONS,
  });

  assert.equal(nodes[1].textContent, 'Compliant');
  assert.equal(
    /** @type {HTMLElement} */ (nodes[1]).className,
    'cora-outcome-pass'
  );
});

test('Outcome supports every configured id and creates a safe class suffix', () => {
  const nodes = Outcome({
    computeOutcome: () => ({ outcome: 'Needs Review!' }),
    answers: {},
    allAnswered: true,
    outcomeOptions: [
      { id: 'Needs Review!', wording: 'Escalate', severity: 75 },
    ],
  });

  assert.equal(nodes[1].textContent, 'Escalate');
  assert.equal(
    /** @type {HTMLElement} */ (nodes[1]).className,
    'cora-outcome-needs-review'
  );
});

test('Outcome exposes an unconfigured result instead of inventing wording', () => {
  const nodes = Outcome({
    computeOutcome: () => ({ outcome: 'unknown' }),
    answers: {},
    allAnswered: true,
    outcomeOptions: OPTIONS,
  });

  assert.equal(nodes[1].textContent, 'Outcome not configured');
  assert.equal(
    /** @type {HTMLElement} */ (nodes[1]).className,
    'cora-outcome-indeterminate'
  );
});

test('Outcome names the value an amendment displaced', () => {
  const nodes = Outcome({
    computeOutcome: () => ({ outcome: 'pass' }),
    answers: {},
    allAnswered: true,
    outcomeOptions: OPTIONS,
    displacedOutcome: 'fail',
  });

  assert.equal(nodes[1].textContent, 'Compliant (previously Non-compliant)');
  // The verdict styling follows the value in force, not the one it displaced.
  assert.equal(
    /** @type {HTMLElement} */ (nodes[1]).className,
    'cora-outcome-pass'
  );
  assert.ok(
    findByClass(
      /** @type {HTMLElement} */ (nodes[1]),
      'cora-outcome-amended-from'
    ),
    'the marker is its own element, so it can be styled apart from the verdict'
  );
});

test('Outcome falls back to the raw displaced id when it is no longer a configured option', () => {
  const nodes = Outcome({
    computeOutcome: () => ({ outcome: 'pass' }),
    answers: {},
    allAnswered: true,
    outcomeOptions: OPTIONS,
    displacedOutcome: 'retired-verdict',
  });

  assert.equal(nodes[1].textContent, 'Compliant (previously retired-verdict)');
});

test('Outcome omits the marker when the amendment did not change the verdict', () => {
  const nodes = Outcome({
    computeOutcome: () => ({ outcome: 'pass' }),
    answers: {},
    allAnswered: true,
    outcomeOptions: OPTIONS,
    displacedOutcome: 'pass',
  });

  assert.equal(nodes[1].textContent, 'Compliant');
});
