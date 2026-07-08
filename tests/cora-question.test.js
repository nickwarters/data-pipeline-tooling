// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

// ===== IMPORTS =====
const { CORAQuestion, Question } =
  await import('../src/components/sections/cora-question.js');

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

// `outcome`-type questions render as a single-choice radio group whose options
// are the configured Outcome wordings (compiled onto the question).
const Q_OUTCOME = /** @type {QuestionDefinition} */ ({
  id: 'q3',
  text: 'Overall assessment',
  responseType: 'outcome',
  options: ['Pass', 'Refer', 'Fail'],
  optionOutcomes: { Pass: 'pass', Refer: 'refer', Fail: 'fail' },
  deprecated: false,
});

test('Question: outcome-type renders a radiogroup of outcome options and emits the selection', () => {
  /** @type {any[]} */
  const answers = [];
  const nodes = Question({
    question: Q_OUTCOME,
    currentValue: 'Refer',
    access: 'edit',
    onAnswer: (detail) => answers.push(detail),
  });
  const fieldset = /** @type {any} */ (nodes[0]);
  assert.equal(fieldset.role, 'radiogroup');
  // legend + 3 option labels
  assert.equal(fieldset._children.length, 4);
  const referRadio = fieldset._children[2]._children[0];
  assert.equal(referRadio.checked, true);
  const failRadio = fieldset._children[3]._children[0];
  failRadio._listeners.change[0]();
  assert.deepEqual(answers.at(-1), { questionId: 'q3', value: 'Fail' });
});

test('CORAQuestion: renders nothing if question is missing', () => {
  const el = new CORAQuestion();
  el.connectedCallback();
  assert.equal(/** @type {any} */ (el)._children.length, 0);
});

test('Question: plain function renders no nodes when question is missing', () => {
  const nodes = Question({
    question: null,
    currentValue: '',
    access: 'edit',
    onAnswer() {},
  });

  assert.deepEqual(nodes, []);
});

test('Question: plain function renders answers and emits through onAnswer', () => {
  /** @type {any[]} */
  const answers = [];
  const nodes = Question({
    question: Q_YES_NO,
    currentValue: 'No',
    access: 'edit',
    onAnswer: (detail) => answers.push(detail),
  });

  const fieldset = /** @type {any} */ (nodes[0]);
  assert.equal(fieldset.className, 'cora-question');
  const yesRadio = fieldset._children[1]._children[0];
  const noRadio = fieldset._children[2]._children[0];

  assert.equal(yesRadio.checked, false);
  assert.equal(noRadio.checked, true);

  yesRadio._listeners['change'][0]();
  assert.deepEqual(answers, [{ questionId: 'q1', value: 'Yes' }]);
});

test('CORAQuestion: renders yes-no-na options', () => {
  const el = new CORAQuestion();
  el.question = Q_YES_NO;
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  assert.equal(fieldset.className, 'cora-question');
  // legend + 3 labels
  assert.equal(fieldset._children.length, 4);
});

test('CORAQuestion: renders multi-choice options', () => {
  const el = new CORAQuestion();
  el.question = Q_MULTI;
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  assert.equal(fieldset.getAttribute('role'), 'group');
  // legend + 2 labels
  assert.equal(fieldset._children.length, 3);
});

test('CORAQuestion: single-choice radio change dispatches event', () => {
  const el = new CORAQuestion();
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
  assert.equal(events[0].type, 'cora-answer');
  assert.equal(events[0].detail.value, 'Yes');
});

test('CORAQuestion: multi-choice change handler exercises both checked branches', () => {
  const el = new CORAQuestion();
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

test('CORAQuestion: read-only access disables inputs', () => {
  const el = new CORAQuestion();
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

test('CORAQuestion: multi-choice read-only access ignores changes', () => {
  const el = new CORAQuestion();
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

test('CORAQuestion: failed answer with no selected actions shows an empty remediation container (issue #250)', () => {
  const q = {
    ...Q_YES_NO,
    remediationActions: ['Action 1'],
    failureCriteria: 'No',
  };
  const el = new CORAQuestion();
  el.question = q;
  el.currentValue = 'No';
  el.connectedCallback();

  // The Review tab mirrors only *selected* actions; with none selected it shows
  // the question fieldset plus an empty remediation container (no action list).
  const children = /** @type {any} */ (el)._children;
  assert.equal(children.length, 2);
  assert.equal(children[0].className, 'cora-question');
  assert.equal(children[1].className, 'cora-question-remediation');
  assert.equal(children[1]._children.length, 0, 'no selected actions shown');
});

test('CORAQuestion: renders the selected actions + free-form read-only beneath a failed answer (issue #250)', () => {
  const el = new CORAQuestion();
  el.question = { ...Q_YES_NO, failureCriteria: 'No' };
  el.currentValue = 'No';
  el.selectedActions = ['Retrain agent.', 'Update script.'];
  el.freeFormRemediation = 'Escalate to legal';
  el.connectedCallback();

  const rem = /** @type {any} */ (el)._children[1];
  assert.equal(rem.className, 'cora-question-remediation');
  const label = rem._children[0];
  assert.equal(label.className, 'cora-question-remediation-label');
  const list = rem._children[1];
  assert.equal(list.className, 'cora-question-remediation-actions');
  assert.deepEqual(
    list._children.map((/** @type {any} */ li) => li.textContent),
    ['Retrain agent.', 'Update script.']
  );
  const free = rem._children[2];
  assert.equal(free.className, 'cora-question-remediation-freeform');
  assert.equal(free.textContent, 'Escalate to legal');
});

test('CORAQuestion: syncRemediation refreshes the read-only display without rebuilding inputs (issue #250)', () => {
  const el = new CORAQuestion();
  el.question = { ...Q_YES_NO, failureCriteria: 'No' };
  el.currentValue = 'No';
  el.connectedCallback();

  const fieldsetBefore = /** @type {any} */ (el)._children[0];
  el.syncRemediation(['Retrain agent.'], '');
  const fieldsetAfter = /** @type {any} */ (el)._children[0];
  assert.equal(
    fieldsetAfter,
    fieldsetBefore,
    'the question inputs are not rebuilt'
  );

  const rem = /** @type {any} */ (el)._children[1];
  assert.equal(rem._children[1].className, 'cora-question-remediation-actions');
  assert.equal(rem._children[1]._children[0].textContent, 'Retrain agent.');

  // Clearing the selection empties the container in place.
  el.syncRemediation([], '');
  assert.equal(/** @type {any} */ (el)._children[1]._children.length, 0);
});

test('CORAQuestion: renders single-choice with custom options', () => {
  const el = new CORAQuestion();
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

test('CORAQuestion: a passing answer shows an empty remediation container', () => {
  const el = new CORAQuestion();
  el.question = {
    ...Q_YES_NO,
    remediationActions: ['Act'],
    failureCriteria: 'No',
  };
  el.currentValue = 'Yes';
  el.selectedActions = [];
  el.connectedCallback();
  const children = /** @type {any} */ (el)._children;
  assert.equal(children.length, 2);
  assert.equal(children[1].className, 'cora-question-remediation');
  assert.equal(children[1]._children.length, 0);
});

test('CORAQuestion: _renderSingleChoice handles non-string currentValue', () => {
  const el = new CORAQuestion();
  el.question = Q_YES_NO;
  // @ts-ignore
  el.currentValue = null;
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  const radio = fieldset._children[1]._children[0];
  assert.equal(radio.checked, false);
});

test('CORAQuestion: _renderSingleChoice handles array currentValue', () => {
  const el = new CORAQuestion();
  el.question = Q_YES_NO;
  // @ts-ignore
  el.currentValue = ['Yes'];
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  const radio = fieldset._children[1]._children[0];
  assert.equal(radio.checked, false);
});

test('CORAQuestion: _renderMultiChoice handles missing options', () => {
  const el = new CORAQuestion();
  el.question = { ...Q_MULTI, options: undefined };
  el.connectedCallback();

  const fieldset = /** @type {any} */ (el)._children[0];
  // legend only
  assert.equal(fieldset._children.length, 1);
});

test('CORAQuestion: _renderMultiChoice handles non-array currentValue', () => {
  const el = new CORAQuestion();
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

test('CORAQuestion: focus() forwards to input', () => {
  const el = new CORAQuestion();
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

test('CORAQuestion: focus() does nothing if no input found', () => {
  const el = new CORAQuestion();
  el.question = Q_YES_NO;
  el.connectedCallback();

  // Override querySelector to return null
  el.querySelector = () => null;

  /** @type {any} */ (globalThis)._lastFocused = 'initial';
  el.focus();
  assert.equal(/** @type {any} */ (globalThis)._lastFocused, 'initial');
});

test('CORAQuestion: single-choice with no options renders empty fieldset (covers q.options ?? [])', () => {
  const el = new CORAQuestion();
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
