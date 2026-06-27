// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_bank-dom-stub.js';
installDom();

const { CRQuestionList } =
  await import('../src/components/cr-question-list.js');

test('CRQuestionList: renders questions in the provided catalogue order', () => {
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

  const el = new CRQuestionList();
  el.update(questions, {});

  assert.deepEqual(
    el.questionElements.map((qEl) => qEl.question?.id),
    ['q2', 'q1']
  );
});
