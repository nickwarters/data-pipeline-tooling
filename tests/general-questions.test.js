// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  generalAnswerKey,
  GENERAL_ANSWER_PREFIX,
  GENERAL_QUESTION_TYPES,
  validateGeneralQuestions,
  validateAnswerKeyNamespace,
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
