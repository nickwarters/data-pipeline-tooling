// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARED_GENERAL_QUESTIONS,
  resolveGeneralQuestions,
} from '../case-types/general-questions.js';
import { GENERAL_QUESTION_TYPES } from '../src/evaluators/general-questions.js';

/** @typedef {import('../src/sharepoint-client.js').GeneralQuestionField} GeneralQuestionField */

/** @type {GeneralQuestionField} */
const OWN = {
  key: 'branchVisited',
  label: 'Branch visited?',
  type: 'radio',
  options: ['Yes', 'No'],
};

test('a shared General Question resolves to a field carrying its catalogue key', () => {
  const [field] = resolveGeneralQuestions(['reviewerObservations']);
  assert.equal(field.key, 'reviewerObservations');
  assert.equal(
    field.label,
    SHARED_GENERAL_QUESTIONS.reviewerObservations.label
  );
  assert.equal(field.type, SHARED_GENERAL_QUESTIONS.reviewerObservations.type);
});

test('the shared key is not something an importing Case Type can restate or diverge on', () => {
  // The catalogue holds no `key` of its own — the record key *is* the answer
  // key — so two Case Types including the same question cannot split reporting.
  for (const [key, definition] of Object.entries(SHARED_GENERAL_QUESTIONS)) {
    assert.equal('key' in definition, false, `${key} declares its own key`);
    assert.equal(resolveGeneralQuestions([key])[0].key, key);
  }
});

test('every shared definition is one the Review tab can actually render', () => {
  for (const [key, definition] of Object.entries(SHARED_GENERAL_QUESTIONS)) {
    assert.ok(
      GENERAL_QUESTION_TYPES.includes(definition.type),
      `${key} has unsupported type ${definition.type}`
    );
    assert.ok(definition.label.length > 0, `${key} has a label`);
    if (definition.type === 'select' || definition.type === 'radio') {
      assert.ok(
        Array.isArray(definition.options) && definition.options.length > 0,
        `${key} (${definition.type}) carries a non-empty options[]`
      );
    }
  }
});

test('a Case Type mixes shared inclusions with its own questions, in declared order', () => {
  const fields = resolveGeneralQuestions([
    'reviewChannel',
    OWN,
    'reviewerObservations',
  ]);
  assert.deepEqual(
    fields.map((field) => field.key),
    ['reviewChannel', 'branchVisited', 'reviewerObservations']
  );
});

test('declaring no General Questions resolves to none', () => {
  assert.deepEqual(resolveGeneralQuestions([]), []);
  assert.deepEqual(resolveGeneralQuestions(), []);
});

test('including an unknown shared question fails at load, naming the known ones', () => {
  assert.throws(
    () => resolveGeneralQuestions(['reviewerObservation']),
    (/** @type {Error} */ error) =>
      error.message.includes('reviewerObservation') &&
      error.message.includes('reviewerObservations')
  );
});

test('a Case Type-specific question may not reuse a shared key', () => {
  assert.throws(
    () =>
      resolveGeneralQuestions([
        'reviewChannel',
        { ...OWN, key: 'reviewChannel' },
      ]),
    /Duplicate General Question key "reviewChannel"/
  );
});

test('a Case Type-specific question is held to the same type vocabulary', () => {
  assert.throws(
    () =>
      resolveGeneralQuestions([
        { key: 'owner', label: 'Owner', type: /** @type {any} */ ('person') },
      ]),
    /Unsupported General Question type "person"/
  );
});

test('resolving copies the shared definition, so one Case Type cannot edit another', () => {
  const [mine] = resolveGeneralQuestions(['reviewChannel']);
  mine.label = 'Rewritten';
  mine.options = ['Only mine'];

  const [theirs] = resolveGeneralQuestions(['reviewChannel']);
  assert.equal(theirs.label, SHARED_GENERAL_QUESTIONS.reviewChannel.label);
  assert.deepEqual(
    theirs.options,
    SHARED_GENERAL_QUESTIONS.reviewChannel.options
  );
});

test('the options copy is a real copy: mutating it in place leaves the catalogue alone', () => {
  // Reassignment would pass even against a shared array — an in-place push is
  // what catches a shallow spread.
  const before = [...(SHARED_GENERAL_QUESTIONS.reviewChannel.options ?? [])];
  const [mine] = resolveGeneralQuestions(['reviewChannel']);
  const [theirs] = resolveGeneralQuestions(['reviewChannel']);
  mine.options?.push('Only mine');

  assert.deepEqual(SHARED_GENERAL_QUESTIONS.reviewChannel.options, before);
  assert.deepEqual(theirs.options, before);
});

test('a shared question may be included with this Case Type insisting on an answer', () => {
  const [bare] = resolveGeneralQuestions(['reviewChannel']);
  const [insisted] = resolveGeneralQuestions([
    { key: 'reviewChannel', required: true },
  ]);
  // Same question, asked the same way — the inclusion adds only how hard this
  // Case Type presses for an answer.
  assert.deepEqual(
    { ...insisted, required: undefined },
    {
      ...bare,
      required: undefined,
    }
  );
  assert.equal(insisted.required, true);
  assert.equal('required' in bare, false);
});

test('an inclusion that would reword a shared question is refused, naming what to remove', () => {
  assert.throws(
    () =>
      resolveGeneralQuestions([
        /** @type {any} */ ({ key: 'reviewChannel', label: 'My wording' }),
      ]),
    /may only add "required".*remove label/s
  );
});

test('an inclusion of an unknown key fails the same way a bare one does', () => {
  assert.throws(
    () => resolveGeneralQuestions([{ key: 'nosuch', required: true }]),
    /Unknown shared General Question "nosuch"/
  );
});

test('an inline question is told apart from an inclusion by declaring its own type', () => {
  const [own] = resolveGeneralQuestions([{ ...OWN, required: true }]);
  assert.equal(own.key, OWN.key);
  assert.equal(own.label, OWN.label);
  assert.equal(own.required, true);
});

test('marking a shared question required leaves every other Case Type asking it as before', () => {
  resolveGeneralQuestions([{ key: 'reviewChannel', required: true }]);
  const [theirs] = resolveGeneralQuestions(['reviewChannel']);
  assert.equal('required' in theirs, false);
  assert.equal(
    'required' in SHARED_GENERAL_QUESTIONS.reviewChannel,
    false,
    'the catalogue itself says nothing about who insists'
  );
});

test('an inclusion is free to say nothing about required, and then says nothing about it', () => {
  // The object and the bare-string forms are the same declaration written two
  // ways; neither invents a `required: false` the gate would have to interpret.
  const [object] = resolveGeneralQuestions([{ key: 'reviewChannel' }]);
  const [string] = resolveGeneralQuestions(['reviewChannel']);
  assert.deepEqual(object, string);
  assert.equal('required' in object, false);

  const [explicit] = resolveGeneralQuestions([
    { key: 'reviewChannel', required: false },
  ]);
  assert.equal('required' in explicit, false);
});
