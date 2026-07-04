// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
installDom();

const { CORAQuestionList, QuestionList } =
  await import('../src/components/collections/cora-question-list.js');

test('QuestionList: composes question hosts in catalogue order', () => {
  const questions = [
    {
      id: 'q2',
      text: 'Second first',
      responseType: /** @type {const} */ ('yes-no-na'),
      deprecated: false,
    },
    {
      id: 'q1',
      text: 'First second',
      responseType: /** @type {const} */ ('yes-no-na'),
      deprecated: false,
    },
  ];

  const elements = QuestionList({
    questions,
    answers: {},
    access: 'edit',
  });

  assert.deepEqual(
    elements.map((qEl) => qEl.question?.id),
    ['q2', 'q1']
  );
});

test('QuestionList: reuses existing question hosts by id', () => {
  const questions = [
    {
      id: 'q1',
      text: 'First',
      responseType: /** @type {const} */ ('yes-no-na'),
      deprecated: false,
    },
    {
      id: 'q2',
      text: 'Second',
      responseType: /** @type {const} */ ('yes-no-na'),
      deprecated: false,
    },
  ];

  const initial = QuestionList({
    questions,
    answers: {},
    access: 'edit',
  });
  const updated = QuestionList({
    questions,
    answers: { q1: { value: 'No' } },
    access: 'read-only',
    existing: initial,
  });

  assert.equal(updated[0], initial[0]);
  assert.equal(updated[1], initial[1]);
  assert.equal(updated[0].currentValue, 'No');
  assert.equal(updated[0].access, 'read-only');
});

test('QuestionList: defaults unanswered multi-choice questions to an empty array', () => {
  const [element] = QuestionList({
    questions: [
      {
        id: 'q-multi',
        text: 'Products?',
        responseType: /** @type {const} */ ('multi-choice'),
        options: ['A', 'B'],
        deprecated: false,
      },
    ],
    answers: {},
    access: 'edit',
  });

  assert.deepEqual(element.currentValue, []);
});

test('CORAQuestionList: renders questions in the provided catalogue order', () => {
  const questions = [
    {
      id: 'q2',
      text: 'Second first',
      responseType: /** @type {const} */ ('yes-no-na'),
      deprecated: false,
    },
    {
      id: 'q1',
      text: 'First second',
      responseType: /** @type {const} */ ('yes-no-na'),
      deprecated: false,
    },
  ];

  const el = new CORAQuestionList();
  el.update(questions, {});

  assert.deepEqual(
    el.questionElements.map((qEl) => qEl.question?.id),
    ['q2', 'q1']
  );
});

test('QuestionList: composed question hosts dispatch answer events', () => {
  const el = new CORAQuestionList();
  el.update(
    [
      {
        id: 'q1',
        text: 'First',
        responseType: /** @type {const} */ ('yes-no-na'),
        deprecated: false,
      },
    ],
    {}
  );

  /** @type {unknown} */
  let detail;
  el.questionElements[0].dispatchEvent = (event) => {
    detail = /** @type {CustomEvent} */ (event).detail;
    return true;
  };

  const input = /** @type {any} */ (
    el.questionElements[0].querySelector('[data-focus-key="answer:q1:1"]')
  );
  input._listeners.change[0]({
    target: input,
  });

  assert.deepEqual(detail, { questionId: 'q1', value: 'No' });
});
