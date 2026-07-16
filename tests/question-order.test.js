// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canMoveCategory,
  canMoveGroup,
  canMoveQuestionWithinGroup,
  categoryKey,
  categoryOrder,
  groupKey,
  groupOrder,
  moveCategory,
  moveGroup,
  moveQuestion,
  moveQuestionWithinGroup,
} from '../src/lib/question-order.js';

test('groupKey treats a missing questionGroup as Uncategorised', () => {
  assert.equal(groupKey({}), 'Uncategorised');
  assert.equal(groupKey({ questionGroup: '' }), 'Uncategorised');
  assert.equal(groupKey({ questionGroup: 'Opening' }), 'Opening');
});

test('categoryKey treats a missing category as Uncategorised', () => {
  assert.equal(categoryKey({}), 'Uncategorised');
  assert.equal(categoryKey({ category: '' }), 'Uncategorised');
  assert.equal(categoryKey({ category: 'COGG A' }), 'COGG A');
});

test('groupOrder returns Question Groups in first-seen question order', () => {
  const questions = [
    { id: 'q1', questionGroup: 'Opening' },
    { id: 'q2', questionGroup: 'Discovery' },
    { id: 'q3', questionGroup: 'Opening' },
  ];

  assert.deepEqual(groupOrder(questions), ['Opening', 'Discovery']);
});

test('categoryOrder returns categories in first-seen question order', () => {
  const questions = [
    { id: 'q1', category: 'A', questionGroup: 'Opening' },
    { id: 'q2', category: 'B', questionGroup: 'Discovery' },
    { id: 'q3', category: 'A', questionGroup: 'Closing' },
  ];

  assert.deepEqual(categoryOrder(questions), ['A', 'B']);
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

test('moveQuestionWithinGroup skips questions from other groups', () => {
  const questions = [
    { id: 'a1', questionGroup: 'A' },
    { id: 'b1', questionGroup: 'B' },
    { id: 'a2', questionGroup: 'A' },
  ];

  assert.equal(moveQuestionWithinGroup(questions, questions[2], -1), true);
  assert.deepEqual(
    questions.map((q) => q.id),
    ['a2', 'a1', 'b1']
  );
});

test('moveQuestionWithinGroup returns false when there is no sibling', () => {
  const questions = [
    { id: 'a1', questionGroup: 'A' },
    { id: 'b1', questionGroup: 'B' },
  ];

  assert.equal(canMoveQuestionWithinGroup(questions, questions[0], -1), false);
  assert.equal(moveQuestionWithinGroup(questions, questions[0], -1), false);
  assert.equal(moveQuestionWithinGroup(questions, questions[0], 1), false);
  assert.deepEqual(
    questions.map((q) => q.id),
    ['a1', 'b1']
  );
});

test('moveGroup reorders a Question Group within its category only', () => {
  const questions = [
    { id: 'a1', category: 'Cat1', questionGroup: 'A' },
    { id: 'a2', category: 'Cat1', questionGroup: 'A' },
    { id: 'b1', category: 'Cat1', questionGroup: 'B' },
    { id: 'x1', category: 'Cat2', questionGroup: 'X' },
  ];

  assert.equal(moveGroup(questions, 'Cat1', 'B', -1), true);
  assert.deepEqual(
    questions.map((q) => q.id),
    ['b1', 'a1', 'a2', 'x1']
  );
});

test('moveGroup returns false at category boundaries', () => {
  const questions = [
    { id: 'a1', category: 'Cat1', questionGroup: 'A' },
    { id: 'b1', category: 'Cat1', questionGroup: 'B' },
    { id: 'x1', category: 'Cat2', questionGroup: 'X' },
  ];

  assert.equal(canMoveGroup(questions, 'Cat1', 'A', -1), false);
  assert.equal(moveGroup(questions, 'Cat1', 'A', -1), false);
  // 'B' is the last group in Cat1: it cannot move into Cat2.
  assert.equal(moveGroup(questions, 'Cat1', 'B', 1), false);
  assert.deepEqual(
    questions.map((q) => q.id),
    ['a1', 'b1', 'x1']
  );
});

test('moveGroup leaves interleaved other-category questions in place', () => {
  const questions = [
    { id: 'a1', category: 'Cat1', questionGroup: 'A' },
    { id: 'x1', category: 'Cat2', questionGroup: 'X' },
    { id: 'b1', category: 'Cat1', questionGroup: 'B' },
  ];

  assert.equal(moveGroup(questions, 'Cat1', 'B', -1), true);
  // Cat1's questions swap within Cat1's index slots; x1 keeps its position.
  assert.deepEqual(
    questions.map((q) => q.id),
    ['b1', 'x1', 'a1']
  );
});

test('moveGroup works with the Uncategorised category fallback', () => {
  const questions = [
    { id: 'a1', questionGroup: 'A' },
    { id: 'b1', questionGroup: 'B' },
  ];

  assert.equal(moveGroup(questions, 'Uncategorised', 'B', -1), true);
  assert.deepEqual(
    questions.map((q) => q.id),
    ['b1', 'a1']
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

test('moveCategory returns false at boundaries', () => {
  const questions = [
    { id: 'a1', category: 'A' },
    { id: 'b1', category: 'B' },
  ];

  assert.equal(canMoveCategory(questions, 'A', -1), false);
  assert.equal(moveCategory(questions, 'A', -1), false);
  assert.equal(moveCategory(questions, 'B', 1), false);
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
