// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  generalAnswerKey,
  generalAnswerText,
  unfilledRequiredGeneralQuestion,
  GENERAL_ANSWER_PREFIX,
  GENERAL_QUESTION_TYPES,
  validateGeneralQuestions,
  validateAnswerKeyNamespace,
  resolveGeneralQuestionsPlacement,
} = await import('../src/evaluators/general-questions.js');

/** @typedef {import('../src/sharepoint-client.js').GeneralQuestionField} GeneralQuestionField */

test('a General Question answer key is namespaced', () => {
  assert.equal(GENERAL_ANSWER_PREFIX, 'general:');
  assert.equal(generalAnswerKey('reviewChannel'), 'general:reviewChannel');
});

test('a Case Type declaring no General Questions validates', () => {
  assert.doesNotThrow(() => validateGeneralQuestions(undefined));
  assert.doesNotThrow(() => validateGeneralQuestions([]));
});

test('every supported field type is accepted', () => {
  assert.deepEqual(GENERAL_QUESTION_TYPES, [
    'text',
    'textarea',
    'select',
    'radio',
  ]);
  assert.doesNotThrow(() =>
    validateGeneralQuestions(
      GENERAL_QUESTION_TYPES.map((type, index) => ({
        key: `f${index}`,
        label: type,
        type: /** @type {GeneralQuestionField['type']} */ (type),
      }))
    )
  );
});

test('a duplicate key is rejected — two fields would share one answer', () => {
  assert.throws(
    () =>
      validateGeneralQuestions([
        { key: 'channel', label: 'Channel', type: 'text' },
        { key: 'channel', label: 'Channel again', type: 'textarea' },
      ]),
    /Duplicate General Question key "channel"/
  );
});

test('an unsupported field type is rejected rather than silently degraded', () => {
  assert.throws(
    () =>
      validateGeneralQuestions([
        {
          key: 'owner',
          label: 'Owner',
          type: /** @type {any} */ ('person'),
        },
      ]),
    /Unsupported General Question type "person" for "owner"/
  );
});

test('a Question Definition id may not look like a namespaced key', () => {
  assert.doesNotThrow(() =>
    validateAnswerKeyNamespace([
      /** @type {any} */ ({ id: 'q-welcome', text: 'Welcome?' }),
    ])
  );
  assert.throws(
    () =>
      validateAnswerKeyNamespace([
        /** @type {any} */ ({ id: 'general:reviewChannel', text: 'Nope' }),
      ]),
    /contains ":", which is reserved/
  );
});

test('the placement resolver returns the two legal values unchanged', () => {
  assert.equal(
    resolveGeneralQuestionsPlacement({ generalQuestionsPlacement: 'before' }),
    'before'
  );
  assert.equal(
    resolveGeneralQuestionsPlacement({ generalQuestionsPlacement: 'after' }),
    'after'
  );
});

test('an absent placement resolves to the documented default, after', () => {
  assert.equal(resolveGeneralQuestionsPlacement(undefined), 'after');
  assert.equal(resolveGeneralQuestionsPlacement(null), 'after');
  assert.equal(resolveGeneralQuestionsPlacement({}), 'after');
  assert.equal(
    resolveGeneralQuestionsPlacement({ generalQuestionsPlacement: undefined }),
    'after'
  );
});

test('an out-of-vocabulary placement coerces to after rather than a third layout', () => {
  // Deliberate: a typo'd Case Type value renders beneath the Question
  // Groups instead of failing to load. `validateGeneralQuestions()` is where a
  // loud rejection would go if a third legal placement is ever added.
  assert.equal(
    resolveGeneralQuestionsPlacement(
      /** @type {any} */ ({ generalQuestionsPlacement: 'BEFORE' })
    ),
    'after'
  );
  assert.equal(
    resolveGeneralQuestionsPlacement(
      /** @type {any} */ ({ generalQuestionsPlacement: 'top' })
    ),
    'after'
  );
});

/** @type {GeneralQuestionField[]} */
const REQUIRED_AND_OPTIONAL = [
  { key: 'reviewChannel', label: 'Channel', type: 'text', required: true },
  { key: 'reviewerObservations', label: 'Observations', type: 'textarea' },
];

test('an unanswered General Question reads as empty text, whatever is stored', () => {
  assert.equal(generalAnswerText({}, 'reviewChannel'), '');
  assert.equal(
    generalAnswerText(
      { 'general:reviewChannel': { value: '' } },
      'reviewChannel'
    ),
    ''
  );
  // A value the section cannot render is not an answer: the Reviewer sees a
  // blank control, so the gate must read one too.
  assert.equal(
    generalAnswerText(
      { 'general:reviewChannel': { value: ['Call recording'] } },
      'reviewChannel'
    ),
    ''
  );
  assert.equal(
    generalAnswerText(
      { 'general:reviewChannel': { value: 'Call recording' } },
      'reviewChannel'
    ),
    'Call recording'
  );
});

test('only a required General Question is owed before the Case may be sent', () => {
  assert.equal(
    unfilledRequiredGeneralQuestion(REQUIRED_AND_OPTIONAL, {}),
    true
  );
  assert.equal(
    unfilledRequiredGeneralQuestion(REQUIRED_AND_OPTIONAL, {
      'general:reviewChannel': { value: 'Call recording' },
    }),
    false,
    'the optional question left blank owes nothing'
  );
  assert.equal(
    unfilledRequiredGeneralQuestion(REQUIRED_AND_OPTIONAL, {
      'general:reviewerObservations': { value: 'Nothing of note' },
    }),
    true,
    'answering the optional one does not discharge the required one'
  );
});

test('a Case Type marking nothing required is gated exactly as it was before the key existed', () => {
  assert.equal(unfilledRequiredGeneralQuestion(undefined, {}), false);
  assert.equal(unfilledRequiredGeneralQuestion([], {}), false);
  assert.equal(
    unfilledRequiredGeneralQuestion(
      [
        {
          key: 'reviewerObservations',
          label: 'Observations',
          type: 'textarea',
        },
      ],
      {}
    ),
    false
  );
});

test('a required General Question is a declaration, not an Answer the evaluators can see', () => {
  // The gate walks the Case Type's field list; every outcome-driving evaluator
  // walks the catalogue. A `general:` key cannot appear in one, which is what
  // keeps a required question a question about *timing*.
  assert.doesNotThrow(() =>
    validateAnswerKeyNamespace([
      {
        id: 'reviewChannel',
        text: 'A Question Definition sharing the bare name',
        responseType: 'yes-no-na',
        failureValues: ['No'],
        deprecated: false,
      },
    ])
  );
  assert.doesNotThrow(() => validateGeneralQuestions(REQUIRED_AND_OPTIONAL));
});
