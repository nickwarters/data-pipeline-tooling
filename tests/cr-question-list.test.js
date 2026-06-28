// @ts-check
// TODO(simplify-ui): Rewrite these lifecycle-heavy tests around the
// future function-component API. Prefer asserting plain functions, h() output,
// reactive() updates, and route-shell behavior over manual connectedCallback()/
// disconnectedCallback() calls on custom element classes.

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
