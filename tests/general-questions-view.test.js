// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findAllByClass } from './_dom-stub.js';
import { fireEvent } from './helpers/semantic-dom.js';

installDom();

const { GeneralQuestions, withGeneralQuestions } =
  await import('../src/pages/cora-case-review/general-questions-view.js');
const { generalAnswerKey } =
  await import('../src/evaluators/general-questions.js');
const { computeQuestionGroupProgress } =
  await import('../src/evaluators/question-group-progress.js');
const { evaluate, allApplicableAnswered } =
  await import('../src/evaluators/applicability-evaluator.js');
const { isFailure } = await import('../src/evaluators/failure-evaluator.js');
const { computeConfiguredOutcome } =
  await import('../src/evaluators/configured-outcome.js');

/** @typedef {import('../src/sharepoint-client.js').GeneralQuestionField} GeneralQuestionField */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

/** @type {GeneralQuestionField[]} */
const FIELDS = [
  { key: 'reviewerNotes', label: 'Reviewer notes', type: 'textarea' },
  {
    key: 'reviewChannel',
    label: 'Review channel',
    type: 'select',
    options: ['Phone', 'Letter'],
  },
  {
    key: 'secondChecked',
    label: 'Second checked?',
    type: 'radio',
    options: ['Yes', 'No'],
  },
];

/** @param {Node[]} nodes */
function rootOf(nodes) {
  const root = document.createElement('div');
  root.append(...nodes);
  return root;
}

/**
 * A field's control, addressed the way the framework restores focus to it. A
 * `radio` field tags each of its inputs instead, so it is not addressed here.
 */
function controlOf(/** @type {any} */ root, /** @type {string} */ fieldKey) {
  return root.querySelector(`[data-testid="general-question:${fieldKey}"]`);
}

function render(overrides = {}) {
  return rootOf(
    GeneralQuestions({
      fields: FIELDS,
      answers: {},
      access: /** @type {const} */ ('edit'),
      onAnswer() {},
      ...overrides,
    })
  );
}

test('a Case Type declaring no General Questions renders nothing', () => {
  assert.deepEqual(
    GeneralQuestions({
      fields: [],
      answers: {},
      access: 'edit',
      onAnswer() {},
    }),
    []
  );
});

test('General Questions render below a separator, under their own section title', () => {
  const nodes = GeneralQuestions({
    fields: FIELDS,
    answers: {},
    access: 'edit',
    onAnswer() {},
  });

  assert.equal(nodes[0].tagName, 'HR');
  const root = rootOf(nodes);
  assert.equal(
    findAllByClass(root, 'cora-general-questions-heading')[0].textContent,
    'General Questions'
  );
  assert.equal(findAllByClass(root, 'cora-general-question').length, 3);
});

test('each declared field renders its typed control carrying the current answer', () => {
  const root = render({
    answers: {
      [generalAnswerKey('reviewerNotes')]: { value: 'Handled well' },
      [generalAnswerKey('reviewChannel')]: { value: 'Letter' },
      [generalAnswerKey('secondChecked')]: { value: 'Yes' },
    },
  });

  const notes = controlOf(root, 'reviewerNotes');
  const channel = controlOf(root, 'reviewChannel');
  assert.equal(notes._tagName, 'textarea');
  assert.equal(notes.value, 'Handled well');
  assert.equal(channel._tagName, 'select');
  assert.equal(channel.value, 'Letter');

  const radios = findAllByClass(root, 'cora-capture-radio-group')[0];
  const checked = radios
    .querySelectorAll('input')
    .filter((/** @type {any} */ input) => input.checked);
  assert.deepEqual(
    checked.map((/** @type {any} */ input) => input.value),
    ['Yes']
  );
});

test('editing a General Question reports the answer under its namespaced key', () => {
  /** @type {Array<[string, string|string[]]>} */
  const seen = [];
  const root = render({
    onAnswer: (/** @type {string} */ key, /** @type {string} */ value) =>
      seen.push([key, value]),
  });

  const notes = controlOf(root, 'reviewerNotes');
  const channel = controlOf(root, 'reviewChannel');
  notes.value = 'Rushed';
  fireEvent(notes, 'change');
  channel.value = 'Phone';
  fireEvent(channel, 'change');

  assert.deepEqual(seen, [
    ['general:reviewerNotes', 'Rushed'],
    ['general:reviewChannel', 'Phone'],
  ]);
});

test('a read-only Reviewer sees the answers but cannot edit them', () => {
  /** @type {string[]} */
  const seen = [];
  const root = render({
    access: 'read-only',
    answers: { [generalAnswerKey('reviewerNotes')]: { value: 'Handled well' } },
    onAnswer: (/** @type {string} */ key) => seen.push(key),
  });

  const controls = [
    controlOf(root, 'reviewerNotes'),
    controlOf(root, 'reviewChannel'),
  ];
  assert.equal(controls[0].value, 'Handled well');
  assert.ok(controls.every((/** @type {any} */ control) => control.disabled));
  for (const input of findAllByClass(
    root,
    'cora-capture-radio-group'
  )[0].querySelectorAll('input')) {
    assert.equal(input.disabled, true);
  }

  controls[0].value = 'Tampered';
  fireEvent(controls[0], 'change');
  assert.deepEqual(seen, []);
});

test('placement decides which side of the section the separator falls on', () => {
  const after = GeneralQuestions({
    fields: FIELDS,
    answers: {},
    access: 'edit',
    onAnswer() {},
  });
  const before = GeneralQuestions({
    fields: FIELDS,
    answers: {},
    access: 'edit',
    placement: 'before',
    onAnswer() {},
  });

  assert.deepEqual(
    after.map((node) => node.tagName),
    ['HR', 'SECTION']
  );
  assert.deepEqual(
    before.map((node) => node.tagName),
    ['SECTION', 'HR']
  );
});

// --- General Questions are not outcome-driving -----------------------------
// The evaluators are all catalogue-driven, so a namespaced General Question
// answer sharing the Answers blob must be inert. These lock that in.

/** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
const CATALOGUE = [
  {
    id: 'q1',
    text: 'Was the customer treated fairly?',
    questionGroup: 'Conduct',
    responseType: 'yes-no-na',
    optionOutcomes: { Yes: 'pass', No: 'fail' },
    deprecated: false,
  },
  {
    id: 'q2',
    text: 'Follow-up required?',
    questionGroup: 'Conduct',
    responseType: 'yes-no-na',
    showWhen: { all: [{ questionId: 'q1', equals: 'No' }] },
    deprecated: false,
  },
];

/** @type {Record<string, Answer>} */
const BASE = { q1: { value: 'Yes' } };
/**
 * The same Answers plus General Question answers whose values deliberately
 * mimic outcome-driving responses ('No') — if anything downstream keyed off
 * values rather than the catalogue, these would move the Outcome.
 * @type {Record<string, Answer>}
 */
const WITH_GENERAL = {
  ...BASE,
  [generalAnswerKey('reviewChannel')]: { value: 'No' },
  [generalAnswerKey('secondChecked')]: { value: 'Yes' },
};

const OUTCOME_OPTIONS = [
  { id: 'pass', wording: 'Pass', severity: 0 },
  { id: 'fail', wording: 'Fail', severity: 100 },
];

test('a Case Type places its General Questions before or after the Question Groups', () => {
  const applicable = document.createElement('section');
  applicable.className = 'applicable';
  const props = {
    fields: FIELDS,
    answers: {},
    access: /** @type {const} */ ('edit'),
    onAnswer() {},
  };

  assert.deepEqual(
    withGeneralQuestions(applicable, props).map(
      (/** @type {any} */ node) => node.className
    ),
    ['applicable', 'cora-general-questions-rule', 'cora-general-questions']
  );
  assert.deepEqual(
    withGeneralQuestions(applicable, {
      ...props,
      placement: 'before',
    }).map((/** @type {any} */ node) => node.className),
    ['cora-general-questions', 'cora-general-questions-rule', 'applicable']
  );
  assert.deepEqual(
    withGeneralQuestions(applicable, { ...props, fields: [] }).map(
      (/** @type {any} */ node) => node.className
    ),
    ['applicable']
  );
});

test('General Question answers do not change applicability or completion', () => {
  assert.deepEqual(
    [...evaluate(CATALOGUE, WITH_GENERAL)],
    [...evaluate(CATALOGUE, BASE)]
  );
  assert.equal(
    allApplicableAnswered(CATALOGUE, WITH_GENERAL),
    allApplicableAnswered(CATALOGUE, BASE)
  );
  assert.equal(allApplicableAnswered(CATALOGUE, WITH_GENERAL), true);
});

test('General Question answers do not change Question Group progress', () => {
  assert.deepEqual(
    computeQuestionGroupProgress(CATALOGUE, WITH_GENERAL),
    computeQuestionGroupProgress(CATALOGUE, BASE)
  );
});

test('General Question answers do not change failure evaluation or the Outcome', () => {
  for (const question of CATALOGUE) {
    assert.equal(
      isFailure(question, WITH_GENERAL[question.id]),
      isFailure(question, BASE[question.id])
    );
  }
  assert.deepEqual(
    computeConfiguredOutcome(CATALOGUE, WITH_GENERAL, OUTCOME_OPTIONS, 'pass'),
    computeConfiguredOutcome(CATALOGUE, BASE, OUTCOME_OPTIONS, 'pass')
  );
});
