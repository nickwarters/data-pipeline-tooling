// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

const { CORAQuestion } =
  await import('../src/components/sections/cora-question.js');
const { CORAStatusBanner } =
  await import('../src/components/base/cora-status-banner.js');
const { signal } = await import('../src/lib/signal.js');

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/** @param {QuestionDefinition} question @param {any} value */
function mountQuestion(question, value) {
  const element = new CORAQuestion();
  element.question = question;
  element.currentValue = value;
  element.connectedCallback();
  return /** @type {any} */ (element)._children[0];
}

test('CORAQuestion: yes-no-na renders an accessible required radiogroup', () => {
  const fieldset = mountQuestion(
    /** @type {QuestionDefinition} */ ({
      id: 'q1',
      text: 'Q1?',
      responseType: 'yes-no-na',
      deprecated: false,
    }),
    ''
  );
  assert.equal(fieldset._attrs.role, 'radiogroup');
  assert.equal(fieldset._attrs['aria-required'], 'true');
});

test('CORAQuestion: single-choice uses radiogroup and multi-choice uses group', () => {
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
    )._attrs.role,
    'radiogroup'
  );
  assert.equal(
    mountQuestion(
      /** @type {QuestionDefinition} */ ({
        ...base,
        responseType: 'multi-choice',
      }),
      []
    )._attrs.role,
    'group'
  );
});

test('CORAQuestion: fieldset and answer inputs have stable focus keys', () => {
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
  assert.equal(
    fieldset._children[1]._children[0]._attrs['data-focus-key'],
    'answer:q-chan:0'
  );
  assert.equal(
    fieldset._children[2]._children[0]._attrs['data-focus-key'],
    'answer:q-chan:1'
  );
});

test('CORAStatusBanner: saving banner announces polite status', () => {
  const element = new CORAStatusBanner();
  element.saveQueue = /** @type {any} */ ({
    status: signal(/** @type {'saving'} */ ('saving')),
  });
  element.connectedCallback();
  const node = /** @type {any} */ (element)._children[0];
  assert.equal(node._attrs.role, 'status');
  assert.equal(node._attrs['aria-live'], 'polite');
});
