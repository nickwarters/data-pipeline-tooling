// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

const { Question } =
  await import('../src/components/sections/cora-question.js');
const { StatusBanner } =
  await import('../src/components/base/cora-status-banner.js');

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/** @param {QuestionDefinition} question @param {any} value */
function mountQuestion(question, value) {
  return /** @type {HTMLElement} */ (
    Question({
      question,
      currentValue: value,
      access: 'edit',
      onAnswer() {},
    })[0]
  );
}

test('Question: yes-no-na renders an accessible required radiogroup', () => {
  const fieldset = mountQuestion(
    /** @type {QuestionDefinition} */ ({
      id: 'q1',
      text: 'Q1?',
      responseType: 'yes-no-na',
      deprecated: false,
    }),
    ''
  );
  assert.equal(fieldset.getAttribute('role'), 'radiogroup');
  assert.equal(fieldset.getAttribute('aria-required'), 'true');
});

test('Question: single-choice uses radiogroup and multi-choice uses group', () => {
  const base = {
    id: 'q-choice',
    text: 'Choice?',
    options: ['A', 'B'],
    deprecated: false,
  };
  assert.equal(
    mountQuestion(
      /** @type {QuestionDefinition} */ ({
        ...base,
        responseType: 'single-choice',
      }),
      ''
    ).getAttribute('role'),
    'radiogroup'
  );
  assert.equal(
    mountQuestion(
      /** @type {QuestionDefinition} */ ({
        ...base,
        responseType: 'multi-choice',
      }),
      []
    ).getAttribute('role'),
    'group'
  );
});

test('Question: fieldset and answer inputs have stable focus keys', () => {
  const fieldset = mountQuestion(
    /** @type {QuestionDefinition} */ ({
      id: 'q-chan',
      text: 'Channel?',
      responseType: 'single-choice',
      options: ['Phone', 'Email'],
      deprecated: false,
    }),
    ''
  );
  assert.equal(fieldset.id, 'cora-q-q-chan');
  assert.deepEqual(
    [...fieldset.querySelectorAll('input')].map((input) =>
      input.getAttribute('data-focus-key')
    ),
    ['answer:q-chan:0', 'answer:q-chan:1', 'answer:q-chan:2']
  );
});

test('StatusBanner: saving banner announces polite status', () => {
  const node = /** @type {any} */ (StatusBanner({ status: 'saving' }));
  assert.equal(node._attrs.role, 'status');
  assert.equal(node._attrs['aria-live'], 'polite');
});
