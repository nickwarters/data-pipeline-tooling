// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  categoryKey,
  categoryOrder,
  moveCategory,
  moveQuestion,
  moveQuestionWithinCategory,
} from '../src/question-bank/question-bank-order.js';

test('categoryKey treats missing category as Uncategorised', () => {
  assert.equal(categoryKey({}), 'Uncategorised');
  assert.equal(categoryKey({ category: '' }), 'Uncategorised');
});

test('categoryOrder returns categories in first-seen question order', () => {
  const questions = [
    { id: 'q1', category: 'Opening' },
    { id: 'q2', category: 'Discovery' },
    { id: 'q3', category: 'Opening' },
  ];

  assert.deepEqual(categoryOrder(questions), ['Opening', 'Discovery']);
});

test('moveQuestion swaps adjacent questions globally', () => {
  const questions = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }];

  assert.equal(moveQuestion(questions, questions[1], -1), true);
  assert.deepEqual(
    questions.map((q) => q.id),
    ['q2', 'q1', 'q3']
  );
});

test('moveQuestion returns false at boundaries', () => {
  const questions = [{ id: 'q1' }, { id: 'q2' }];

  assert.equal(moveQuestion(questions, questions[0], -1), false);
  assert.equal(moveQuestion(questions, questions[1], 1), false);
  assert.deepEqual(
    questions.map((q) => q.id),
    ['q1', 'q2']
  );
});

test('moveQuestionWithinCategory skips questions from other categories', () => {
  const questions = [
    { id: 'a1', category: 'A' },
    { id: 'b1', category: 'B' },
    { id: 'a2', category: 'A' },
  ];

  assert.equal(moveQuestionWithinCategory(questions, questions[2], -1), true);
  assert.deepEqual(
    questions.map((q) => q.id),
    ['a2', 'a1', 'b1']
  );
});

test('moveQuestionWithinCategory returns false when there is no sibling', () => {
  const questions = [
    { id: 'a1', category: 'A' },
    { id: 'b1', category: 'B' },
  ];

  assert.equal(moveQuestionWithinCategory(questions, questions[0], -1), false);
  assert.equal(moveQuestionWithinCategory(questions, questions[0], 1), false);
  assert.deepEqual(
    questions.map((q) => q.id),
    ['a1', 'b1']
  );
});

test('moveCategory moves the whole category block and preserves internal order', () => {
  const questions = [
    { id: 'a1', category: 'A' },
    { id: 'a2', category: 'A' },
    { id: 'b1', category: 'B' },
    { id: 'c1', category: 'C' },
  ];

  assert.equal(moveCategory(questions, 'C', -1), true);
  assert.deepEqual(
    questions.map((q) => q.id),
    ['a1', 'a2', 'c1', 'b1']
  );
});

test('moveCategory treats uncategorised questions as a movable block', () => {
  const questions = [
    { id: 'a1', category: 'A' },
    { id: 'u1' },
    { id: 'u2', category: '' },
    { id: 'b1', category: 'B' },
  ];

  assert.equal(moveCategory(questions, 'Uncategorised', 1), true);
  assert.deepEqual(
    questions.map((q) => q.id),
    ['a1', 'b1', 'u1', 'u2']
  );
});
