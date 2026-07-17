// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  getByTag,
  queryAllByRole,
  queryAllByTag,
} from './helpers/semantic-dom.js';

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
  assert.equal(queryAllByRole(fieldset, 'radio').length, 4);
  const referRadio = getByRole(fieldset, 'radio', { name: 'Refer' });
  assert.equal(referRadio.checked, true);
  fireEvent(getByRole(fieldset, 'radio', { name: 'Fail' }), 'change');
  assert.deepEqual(answers.at(-1), { questionId: 'q3', value: 'Fail' });
});

test('CORAQuestion: renders nothing if question is missing', () => {
  const el = new CORAQuestion();
  el.connectedCallback();
  assert.equal(el.childElementCount, 0);
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
  const yesRadio = getByRole(fieldset, 'radio', { name: 'Yes' });
  const noRadio = getByRole(fieldset, 'radio', { name: 'No' });

  assert.equal(yesRadio.checked, false);
  assert.equal(noRadio.checked, true);

  fireEvent(yesRadio, 'change');
  assert.deepEqual(answers, [{ questionId: 'q1', value: 'Yes' }]);
});

test('CORAQuestion: renders yes-no-na options', () => {
  const el = new CORAQuestion();
  el.question = Q_YES_NO;
  el.connectedCallback();

  const fieldset = getByTag(el, 'fieldset');
  assert.equal(fieldset.className, 'cora-question');
  assert.equal(queryAllByRole(fieldset, 'radio').length, 3);
});

test('CORAQuestion: renders multi-choice options', () => {
  const el = new CORAQuestion();
  el.question = Q_MULTI;
  el.connectedCallback();

  const fieldset = getByTag(el, 'fieldset');
  assert.equal(fieldset.getAttribute('role'), 'group');
  assert.equal(queryAllByRole(fieldset, 'checkbox').length, 3);
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

  fireEvent(getByRole(el, 'radio', { name: 'Yes' }), 'change');

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

  const checkbox = getByRole(el, 'checkbox', { name: 'A' });

  // Branch: checkbox.checked = true
  checkbox.checked = true;
  fireEvent(checkbox, 'change', { target: checkbox });
  assert.deepEqual(events[0].detail.value, ['A']);

  // Branch: checkbox.checked = false
  // We need to re-render or update state to simulate the next state where 'A' is selected
  el.update({ currentValue: ['A'] });
  const nextCheckbox = getByRole(el, 'checkbox', { name: 'A' });
  nextCheckbox.checked = false;
  fireEvent(nextCheckbox, 'change', { target: nextCheckbox });
  assert.deepEqual(events[1].detail.value, []);
});

test('CORAQuestion: read-only access disables inputs', () => {
  const el = new CORAQuestion();
  el.question = Q_YES_NO;
  el.access = 'read-only';
  el.connectedCallback();

  const radio = getByRole(el, 'radio', { name: 'Yes' });
  assert.equal(radio.disabled, true);

  /** @type {any[]} */
  const events = [];
  el.dispatchEvent = (e) => {
    events.push(e);
    return true;
  };
  fireEvent(radio, 'change');
  assert.equal(events.length, 0);
});

test('CORAQuestion: multi-choice read-only access ignores changes', () => {
  const el = new CORAQuestion();
  el.question = Q_MULTI;
  el.access = 'read-only';
  el.connectedCallback();

  const checkbox = getByRole(el, 'checkbox', { name: 'A' });

  /** @type {any[]} */
  const events = [];
  el.dispatchEvent = (e) => {
    events.push(e);
    return true;
  };
  fireEvent(checkbox, 'change');
  assert.equal(events.length, 0);
});

test('CORAQuestion: failed answer with no selected actions shows an empty remediation container (issue #250)', () => {
  const q = {
    ...Q_YES_NO,
    remediationActions: ['Action 1'],
    failureValues: ['No'],
  };
  const el = new CORAQuestion();
  el.question = q;
  el.currentValue = 'No';
  el.connectedCallback();

  // The Review tab mirrors only *selected* actions; with none selected it shows
  // the question fieldset plus an empty remediation container (no action list).
  assert.equal(el.childElementCount, 2);
  assert.equal(getByTag(el, 'fieldset').className, 'cora-question');
  const remediation = el.querySelector('.cora-question-remediation');
  assert.ok(remediation);
  assert.equal(remediation.childElementCount, 0, 'no selected actions shown');
});

test('CORAQuestion: renders the selected actions + free-form read-only beneath a failed answer (issue #250)', () => {
  const el = new CORAQuestion();
  el.question = { ...Q_YES_NO, failureValues: ['No'] };
  el.currentValue = 'No';
  el.selectedActions = ['Retrain agent.', 'Update script.'];
  el.freeFormRemediation = 'Escalate to legal';
  el.connectedCallback();

  const rem = el.querySelector('.cora-question-remediation');
  assert.ok(rem);
  assert.equal(rem.className, 'cora-question-remediation');
  const label = rem.querySelector('.cora-question-remediation-label');
  assert.ok(label);
  assert.equal(label.className, 'cora-question-remediation-label');
  const list = getByTag(rem, 'ul');
  assert.equal(list.className, 'cora-question-remediation-actions');
  assert.deepEqual(
    queryAllByTag(list, 'li').map((li) => li.textContent),
    ['Retrain agent.', 'Update script.']
  );
  const free = rem.querySelector('.cora-question-remediation-freeform');
  assert.ok(free);
  assert.equal(free.className, 'cora-question-remediation-freeform');
  assert.equal(free.textContent, 'Escalate to legal');
});

test('CORAQuestion: syncRemediation refreshes the read-only display without rebuilding inputs (issue #250)', () => {
  const el = new CORAQuestion();
  el.question = { ...Q_YES_NO, failureValues: ['No'] };
  el.currentValue = 'No';
  el.connectedCallback();

  const fieldsetBefore = getByTag(el, 'fieldset');
  el.syncRemediation(['Retrain agent.'], '');
  const fieldsetAfter = getByTag(el, 'fieldset');
  assert.equal(
    fieldsetAfter,
    fieldsetBefore,
    'the question inputs are not rebuilt'
  );

  const rem = el.querySelector('.cora-question-remediation');
  assert.ok(rem);
  assert.equal(getByTag(rem, 'li').textContent, 'Retrain agent.');

  // Clearing the selection empties the container in place.
  el.syncRemediation([], '');
  assert.equal(rem.childElementCount, 0);
});

test('CORAQuestion: renders single-choice with custom options', () => {
  const el = new CORAQuestion();
  el.question = {
    ...Q_YES_NO,
    responseType: 'single-choice',
    options: ['Maybe'],
  };
  el.connectedCallback();

  const fieldset = getByTag(el, 'fieldset');
  assert.equal(fieldset.getAttribute('role'), 'radiogroup');
  assert.equal(queryAllByRole(fieldset, 'radio').length, 2);
  assert.equal(getByRole(fieldset, 'radio', { name: 'Maybe' }).value, 'Maybe');
});

test('CORAQuestion: a passing answer shows an empty remediation container', () => {
  const el = new CORAQuestion();
  el.question = {
    ...Q_YES_NO,
    remediationActions: ['Act'],
    failureValues: ['No'],
  };
  el.currentValue = 'Yes';
  el.selectedActions = [];
  el.connectedCallback();
  assert.equal(el.childElementCount, 2);
  const remediation = el.querySelector('.cora-question-remediation');
  assert.ok(remediation);
  assert.equal(remediation.childElementCount, 0);
});

test('CORAQuestion: single choice ignores a null current value', () => {
  const el = new CORAQuestion();
  el.question = Q_YES_NO;
  // @ts-ignore
  el.currentValue = null;
  el.connectedCallback();

  const radio = getByRole(el, 'radio', { name: 'Yes' });
  assert.equal(radio.checked, false);
});

test('CORAQuestion: single choice ignores an array current value', () => {
  const el = new CORAQuestion();
  el.question = Q_YES_NO;
  // @ts-ignore
  el.currentValue = ['Yes'];
  el.connectedCallback();

  const radio = getByRole(el, 'radio', { name: 'Yes' });
  assert.equal(radio.checked, false);
});

test('CORAQuestion: multi choice renders only universal N/A when options are missing', () => {
  const el = new CORAQuestion();
  el.question = { ...Q_MULTI, options: undefined };
  el.connectedCallback();

  assert.deepEqual(
    queryAllByRole(el, 'checkbox').map((checkbox) => checkbox.value),
    ['NA']
  );
});

test('CORAQuestion: multi choice ignores a non-array current value', () => {
  const el = new CORAQuestion();
  el.question = Q_MULTI;
  // @ts-ignore
  el.currentValue = 'A';
  el.connectedCallback();

  const checkbox = getByRole(el, 'checkbox', { name: 'A' });
  // selected Set will be empty because 'A' is not an array, so checkbox should be unchecked
  assert.equal(checkbox.checked, false);
});

test('CORAQuestion: focus() forwards to input', () => {
  const el = new CORAQuestion();
  el.question = Q_YES_NO;
  el.connectedCallback();

  const radio = getByRole(el, 'radio', { name: 'Yes' });

  /** @type {any} */ (globalThis)._lastFocused = null;
  el.focus();
  assert.equal(/** @type {any} */ (globalThis)._lastFocused, radio);
});

test('CORAQuestion: focus() does nothing if no input found', () => {
  const el = new CORAQuestion();
  el.connectedCallback();

  /** @type {any} */ (globalThis)._lastFocused = 'initial';
  el.focus();
  assert.equal(/** @type {any} */ (globalThis)._lastFocused, 'initial');
});

test('Question: single-choice with a long option adds the options-long class', () => {
  const nodes = Question({
    question: {
      ...Q_YES_NO,
      responseType: 'single-choice',
      options: [
        'Yes',
        'No, this is a much longer option text that exceeds forty characters',
      ],
    },
    currentValue: '',
    access: 'edit',
    onAnswer() {},
  });
  const fieldset = /** @type {any} */ (nodes[0]);
  assert.equal(fieldset.className, 'cora-question cora-question-options-long');
});

test('Question: single-choice with only short options does not add the options-long class', () => {
  const nodes = Question({
    question: {
      ...Q_YES_NO,
      responseType: 'single-choice',
      options: ['Yes', 'No'],
    },
    currentValue: '',
    access: 'edit',
    onAnswer() {},
  });
  const fieldset = /** @type {any} */ (nodes[0]);
  assert.equal(fieldset.className, 'cora-question');
});

test('Question: single-choice option labels carry the cora-question-option class', () => {
  const nodes = Question({
    question: Q_YES_NO,
    currentValue: '',
    access: 'edit',
    onAnswer() {},
  });
  const fieldset = /** @type {any} */ (nodes[0]);
  const firstLabel = getByRole(fieldset, 'radio', { name: 'Yes' }).parentNode;
  assert.equal(firstLabel.className, 'cora-question-option');
});

test('Question: outcome-type with a long option also gets the options-long class', () => {
  const nodes = Question({
    question: {
      ...Q_OUTCOME,
      options: [
        'Pass',
        'Refer for further review by the responsible party team',
        'Fail',
      ],
    },
    currentValue: '',
    access: 'edit',
    onAnswer() {},
  });
  const fieldset = /** @type {any} */ (nodes[0]);
  assert.equal(fieldset.className, 'cora-question cora-question-options-long');
});

test('CORAQuestion: single-choice with no options renders empty fieldset (covers q.options ?? [])', () => {
  const el = new CORAQuestion();
  el.question = {
    .../** @type {any} */ (Q_YES_NO),
    responseType: 'single-choice',
    options: undefined,
  };
  el.connectedCallback();
  assert.deepEqual(
    queryAllByRole(el, 'radio').map((radio) => radio.value),
    ['NA'],
    'undefined options falls back to the universal N/A control'
  );
});

test('CORAQuestion: multi-choice N/A is exclusive — selecting it clears real answers', () => {
  const el = new CORAQuestion();
  el.question = Q_MULTI;
  el.currentValue = ['A', 'B'];
  el.connectedCallback();

  /** @type {any[]} */
  const events = [];
  el.dispatchEvent = (e) => {
    events.push(e);
    return true;
  };

  const naCheckbox = getByRole(el, 'checkbox', { name: 'NA' });
  naCheckbox.checked = true;
  fireEvent(naCheckbox, 'change');
  assert.deepEqual(events[0].detail.value, ['NA']);
});

test('CORAQuestion: multi-choice selecting a real answer clears N/A', () => {
  const el = new CORAQuestion();
  el.question = Q_MULTI;
  el.currentValue = ['NA'];
  el.connectedCallback();

  /** @type {any[]} */
  const events = [];
  el.dispatchEvent = (e) => {
    events.push(e);
    return true;
  };

  const aCheckbox = getByRole(el, 'checkbox', { name: 'A' });
  aCheckbox.checked = true;
  fireEvent(aCheckbox, 'change');
  assert.deepEqual(events[0].detail.value, ['A']);
});

test('CORAQuestion: multi-choice unticking N/A leaves an empty answer', () => {
  const el = new CORAQuestion();
  el.question = Q_MULTI;
  el.currentValue = ['NA'];
  el.connectedCallback();

  /** @type {any[]} */
  const events = [];
  el.dispatchEvent = (e) => {
    events.push(e);
    return true;
  };

  const naCheckbox = getByRole(el, 'checkbox', { name: 'NA' });
  naCheckbox.checked = false;
  fireEvent(naCheckbox, 'change');
  assert.deepEqual(events[0].detail.value, []);
});

test('CORAQuestion: yes-no-na renders Yes/No/NA exactly as before (universal N/A)', () => {
  const el = new CORAQuestion();
  el.question = Q_YES_NO;
  el.connectedCallback();
  assert.deepEqual(
    queryAllByRole(el, 'radio').map((radio) => radio.value),
    ['Yes', 'No', 'NA']
  );
});
