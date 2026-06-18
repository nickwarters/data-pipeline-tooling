// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummaryModel } from '../src/evaluators/summary-model.js';

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

/** @type {QuestionDefinition[]} */
const catalogue = [
  { id: 'q-open', text: 'Greeted?', category: 'Opening', responseType: 'yes-no-na', failureCriteria: 'No', deprecated: false },
  { id: 'q-needs', text: 'Needs found?', category: 'Discovery', responseType: 'yes-no-na', failureCriteria: 'No', remediationActions: ['Retrain agent.'], deprecated: false },
  { id: 'q-resolve', text: 'Resolved?', category: 'Discovery', responseType: 'yes-no-na', showWhen: { 'q-needs': { equals: 'Yes' } }, failureCriteria: 'No', remediationActions: ['Escalate.', 'Follow up.'], deprecated: false },
  // Informational (no failureCriteria) — excluded from pass/fail counts.
  { id: 'q-channel', text: 'Channel?', category: 'Opening', responseType: 'single-choice', options: ['Phone'], deprecated: false },
];

test('buildSummaryModel: pass/fail counts per category over answered, applicable, failure-scorable questions', () => {
  const answers = /** @type {Record<string, Answer>} */ ({
    'q-open': { value: 'No' },     // Opening: fail
    'q-needs': { value: 'Yes' },   // Discovery: pass (also makes q-resolve applicable)
    'q-resolve': { value: 'No' },  // Discovery: fail
    'q-channel': { value: 'Phone' }, // not scorable — ignored
  });
  const model = buildSummaryModel(catalogue, answers);
  assert.deepEqual(model.categoryCounts, [
    { category: 'Opening', pass: 0, fail: 1 },
    { category: 'Discovery', pass: 1, fail: 1 },
  ]);
});

test('buildSummaryModel: excludes deprecated questions and unanswered scorable questions from counts', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    { id: 'q-live', text: 'Live?', category: 'A', responseType: 'yes-no-na', failureCriteria: 'No', deprecated: false },
    { id: 'q-old', text: 'Old?', category: 'A', responseType: 'yes-no-na', failureCriteria: 'No', deprecated: true },
    { id: 'q-blank', text: 'Blank?', category: 'A', responseType: 'yes-no-na', failureCriteria: 'No', deprecated: false },
  ];
  // q-live answered, q-old deprecated (dropped), q-blank applicable but unanswered.
  const model = buildSummaryModel(cat, { 'q-live': { value: 'Yes' } });
  assert.deepEqual(model.categoryCounts, [{ category: 'A', pass: 1, fail: 0 }]);
});

test('buildSummaryModel: remediationActionCount sums declared actions across applicable failed questions', () => {
  const answers = /** @type {Record<string, Answer>} */ ({
    'q-open': { value: 'No' },     // failed, but no remediationActions → 0
    'q-needs': { value: 'No' },    // failed → 1 action (q-resolve is now not applicable)
  });
  const model = buildSummaryModel(catalogue, answers);
  assert.equal(model.remediationActionCount, 1);
});

test('buildSummaryModel: remediationActionCount is 0 when there are no failures', () => {
  const answers = /** @type {Record<string, Answer>} */ ({
    'q-open': { value: 'Yes' },
    'q-needs': { value: 'Yes' },
    'q-resolve': { value: 'Yes' },
  });
  assert.equal(buildSummaryModel(catalogue, answers).remediationActionCount, 0);
});

test('buildSummaryModel: failures list each applicable failed Answer with its actions and stringified value', () => {
  const answers = /** @type {Record<string, Answer>} */ ({
    'q-open': { value: 'No' },
    'q-needs': { value: 'Yes' },
    'q-resolve': { value: 'No' },
  });
  const model = buildSummaryModel(catalogue, answers);
  assert.deepEqual(model.failures, [
    { id: 'q-open', category: 'Opening', text: 'Greeted?', answer: 'No', actions: [] },
    { id: 'q-resolve', category: 'Discovery', text: 'Resolved?', answer: 'No', actions: ['Escalate.', 'Follow up.'] },
  ]);
});

test('buildSummaryModel: failure with a multi-choice value joins selections for display', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    { id: 'q-prod', text: 'Defects?', responseType: 'multi-choice', options: ['A', 'B', 'C'], failureCriteria: 'B', remediationActions: ['Fix B.'], deprecated: false },
  ];
  const model = buildSummaryModel(cat, { 'q-prod': { value: ['A', 'B'] } });
  assert.deepEqual(model.failures, [
    { id: 'q-prod', category: undefined, text: 'Defects?', answer: 'A, B', actions: ['Fix B.'] },
  ]);
});
