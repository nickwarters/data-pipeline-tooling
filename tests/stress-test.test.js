// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, allApplicableAnswered, detectCycles } from '../src/applicability-evaluator.js';
import { generateStressQuestions } from '../dev/fixtures/stress-questions.js';

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

test('stress fixture: generator produces the requested number of question definitions', () => {
  const qs = generateStressQuestions(500);
  assert.equal(qs.length, 500);
});

test('stress fixture: every generated question has a unique stable id', () => {
  const qs = generateStressQuestions(500);
  const ids = new Set(qs.map(q => q.id));
  assert.equal(ids.size, 500);
});

test('stress fixture: contains conditional questions that depend on prior answers', () => {
  const qs = generateStressQuestions(500);
  const conditional = qs.filter(q => q.showWhen);
  assert.ok(conditional.length > 50, 'expected at least 50 conditional questions');
});

test('stress fixture: showWhen graph is acyclic', () => {
  const qs = generateStressQuestions(500);
  assert.equal(detectCycles(qs), false);
});

test('stress fixture: applicability evaluation of 500 questions runs in under 50ms', () => {
  const qs = generateStressQuestions(500);
  /** @type {Record<string, Answer>} */
  const answers = {};
  for (const q of qs) {
    if (q.responseType === 'yes-no-na') answers[q.id] = { value: 'Yes' };
    else if (q.responseType === 'single-choice' && q.options) answers[q.id] = { value: q.options[0] };
    else if (q.responseType === 'multi-choice' && q.options) answers[q.id] = { value: [q.options[0]] };
  }

  const start = performance.now();
  for (let i = 0; i < 100; i++) evaluate(qs, answers);
  const elapsedPerRun = (performance.now() - start) / 100;

  assert.ok(elapsedPerRun < 50, `expected <50ms per evaluation, got ${elapsedPerRun.toFixed(2)}ms`);
});

test('stress fixture: toggling a triggering answer changes applicability set in < 5ms', () => {
  const qs = generateStressQuestions(500);
  /** @type {Record<string, Answer>} */
  const answersOff = { 'q-stress-0': { value: 'No' } };
  /** @type {Record<string, Answer>} */
  const answersOn = { 'q-stress-0': { value: 'Yes' } };

  const start = performance.now();
  const setOff = evaluate(qs, answersOff);
  const setOn = evaluate(qs, answersOn);
  const elapsed = performance.now() - start;

  assert.ok(setOn.size !== setOff.size, 'applicability set should differ between Yes and No');
  assert.ok(elapsed < 10, `expected <10ms for two evaluations, got ${elapsed.toFixed(2)}ms`);
});

test('stress fixture: allApplicableAnswered with all questions answered returns true', () => {
  const qs = generateStressQuestions(500);
  /** @type {Record<string, Answer>} */
  const answers = {};
  for (const q of qs) {
    if (q.responseType === 'yes-no-na') answers[q.id] = { value: 'Yes' };
    else if (q.responseType === 'single-choice' && q.options) answers[q.id] = { value: q.options[0] };
    else if (q.responseType === 'multi-choice' && q.options) answers[q.id] = { value: [q.options[0]] };
  }
  assert.equal(allApplicableAnswered(qs, answers), true);
});
