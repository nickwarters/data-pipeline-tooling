// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummaryModel } from '../src/evaluators/summary-model.js';

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

/** @type {QuestionDefinition[]} */
const catalogue = [
  {
    id: 'q-open',
    text: 'Greeted?',
    questionGroup: 'Opening',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
  },
  {
    id: 'q-needs',
    text: 'Needs found?',
    questionGroup: 'Discovery',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    remediationActions: ['Retrain agent.'],
    deprecated: false,
  },
  {
    id: 'q-resolve',
    text: 'Resolved?',
    questionGroup: 'Discovery',
    responseType: 'yes-no-na',
    showWhen: { 'q-needs': { equals: 'Yes' } },
    failureValues: ['No'],
    remediationActions: ['Escalate.', 'Follow up.'],
    deprecated: false,
  },
  // Informational (no failureValues) — excluded from pass/fail counts.
  {
    id: 'q-channel',
    text: 'Channel?',
    questionGroup: 'Opening',
    responseType: 'single-choice',
    options: ['Phone'],
    deprecated: false,
  },
];

test('buildSummaryModel: pass/fail counts per Question Group over answered, applicable, failure-scorable questions', () => {
  const answers = /** @type {Record<string, Answer>} */ ({
    'q-open': { value: 'No' }, // Opening: fail
    'q-needs': { value: 'Yes' }, // Discovery: pass (also makes q-resolve applicable)
    'q-resolve': { value: 'No' }, // Discovery: fail
    'q-channel': { value: 'Phone' }, // not scorable — ignored
  });
  const model = buildSummaryModel(catalogue, answers);
  assert.deepEqual(model.groupCounts, [
    { category: undefined, group: 'Opening', pass: 0, fail: 1 },
    { category: undefined, group: 'Discovery', pass: 1, fail: 1 },
  ]);
});

test('buildSummaryModel: excludes deprecated questions and unanswered scorable questions from counts', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    {
      id: 'q-live',
      text: 'Live?',
      questionGroup: 'A',
      responseType: 'yes-no-na',
      failureValues: ['No'],
      deprecated: false,
    },
    {
      id: 'q-old',
      text: 'Old?',
      questionGroup: 'A',
      responseType: 'yes-no-na',
      failureValues: ['No'],
      deprecated: true,
    },
    {
      id: 'q-blank',
      text: 'Blank?',
      questionGroup: 'A',
      responseType: 'yes-no-na',
      failureValues: ['No'],
      deprecated: false,
    },
  ];
  // q-live answered, q-old deprecated (dropped), q-blank applicable but unanswered.
  const model = buildSummaryModel(cat, { 'q-live': { value: 'Yes' } });
  assert.deepEqual(model.groupCounts, [
    { category: undefined, group: 'A', pass: 1, fail: 0 },
  ]);
});

test('buildSummaryModel: remediationActionCount sums selected actions + free-form across failed answers', () => {
  const answers = /** @type {Record<string, Answer>} */ ({
    // failed, nothing selected but a free-form action → 1
    'q-open': { value: 'No', freeFormRemediation: 'Apologise to customer' },
    // failed with one selected canned action → 1 (q-resolve is now not applicable)
    'q-needs': {
      value: 'No',
      remediationActions: [{ id: 'q-needs-ra-0', text: 'Retrain agent.' }],
    },
  });
  const model = buildSummaryModel(catalogue, answers);
  assert.equal(model.remediationActionCount, 2);
});

test('buildSummaryModel: whitespace-only free-form remediation is not an action', () => {
  // The Summary was the fourth reading of "carries remediation" and the only
  // untrimmed one: `answerRemediation` trims, so a single space in the box gave
  // the Reviewer "Remediation Actions: 1" and a blank bullet on the Summary
  // while the Send Actions fork said "Complete Case" and the Remediation tab
  // showed nothing.
  const answers = /** @type {Record<string, Answer>} */ ({
    'q-open': { value: 'No', freeFormRemediation: '   ' },
  });
  const model = buildSummaryModel(catalogue, answers);
  assert.equal(model.remediationActionCount, 0);
  assert.deepEqual(model.failures[0].actions, []);
});

test('buildSummaryModel: remediationActionCount is 0 when there are no failures', () => {
  const answers = /** @type {Record<string, Answer>} */ ({
    'q-open': { value: 'Yes' },
    'q-needs': { value: 'Yes' },
    'q-resolve': { value: 'Yes' },
  });
  assert.equal(buildSummaryModel(catalogue, answers).remediationActionCount, 0);
});

test('buildSummaryModel: failures list each failed Answer with its selected actions + free-form', () => {
  const answers = /** @type {Record<string, Answer>} */ ({
    'q-open': { value: 'No' }, // failed, nothing selected → no actions
    'q-needs': { value: 'Yes' },
    'q-resolve': {
      value: 'No',
      remediationActions: [{ id: 'q-resolve-ra-0', text: 'Escalate.' }],
      freeFormRemediation: 'Call back within 24h',
    },
  });
  const model = buildSummaryModel(catalogue, answers);
  assert.deepEqual(model.failures, [
    {
      id: 'q-open',
      category: undefined,
      questionGroup: 'Opening',
      text: 'Greeted?',
      answer: 'No',
      actions: [],
    },
    {
      id: 'q-resolve',
      category: undefined,
      questionGroup: 'Discovery',
      text: 'Resolved?',
      answer: 'No',
      // Only the selected canned action, then the free-form entry — not the
      // question's full ['Escalate.', 'Follow up.'] catalogue.
      actions: ['Escalate.', 'Call back within 24h'],
    },
  ]);
});

test('buildSummaryModel: failure with a multi-choice value joins selections for display', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    {
      id: 'q-prod',
      text: 'Defects?',
      responseType: 'multi-choice',
      options: ['A', 'B', 'C'],
      failureValues: ['B'],
      remediationActions: ['Fix B.'],
      deprecated: false,
    },
  ];
  const model = buildSummaryModel(cat, {
    'q-prod': {
      value: ['A', 'B'],
      remediationActions: [{ id: 'q-prod-ra-0', text: 'Fix B.' }],
    },
  });
  assert.deepEqual(model.failures, [
    {
      id: 'q-prod',
      category: undefined,
      questionGroup: undefined,
      text: 'Defects?',
      answer: 'A, B',
      actions: ['Fix B.'],
    },
  ]);
});

test('buildSummaryModel: counts carry the Category their Question Group sits under', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    {
      id: 'q-a',
      text: 'Greeted?',
      category: 'Conduct',
      questionGroup: 'Opening',
      responseType: 'yes-no-na',
      failureValues: ['No'],
      deprecated: false,
    },
    {
      id: 'q-b',
      text: 'Recorded?',
      category: 'Compliance',
      questionGroup: 'Records',
      responseType: 'yes-no-na',
      failureValues: ['No'],
      deprecated: false,
    },
  ];
  const model = buildSummaryModel(cat, {
    'q-a': { value: 'Yes' },
    'q-b': { value: 'No' },
  });
  assert.deepEqual(model.groupCounts, [
    { category: 'Conduct', group: 'Opening', pass: 1, fail: 0 },
    { category: 'Compliance', group: 'Records', pass: 0, fail: 1 },
  ]);
});

test('buildSummaryModel: one Question Group name under two Categories counts as two rows', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    {
      id: 'q-a',
      text: 'Greeted?',
      category: 'Conduct',
      questionGroup: 'Checks',
      responseType: 'yes-no-na',
      failureValues: ['No'],
      deprecated: false,
    },
    {
      id: 'q-b',
      text: 'Recorded?',
      category: 'Compliance',
      questionGroup: 'Checks',
      responseType: 'yes-no-na',
      failureValues: ['No'],
      deprecated: false,
    },
  ];
  const model = buildSummaryModel(cat, {
    'q-a': { value: 'Yes' },
    'q-b': { value: 'No' },
  });
  assert.deepEqual(model.groupCounts, [
    { category: 'Conduct', group: 'Checks', pass: 1, fail: 0 },
    { category: 'Compliance', group: 'Checks', pass: 0, fail: 1 },
  ]);
});

test('buildSummaryModel: a failure carries the Category of the question that failed', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    {
      id: 'q-a',
      text: 'Greeted?',
      category: 'Conduct',
      questionGroup: 'Opening',
      responseType: 'yes-no-na',
      failureValues: ['No'],
      deprecated: false,
    },
  ];
  const model = buildSummaryModel(cat, { 'q-a': { value: 'No' } });
  assert.deepEqual(model.failures, [
    {
      id: 'q-a',
      category: 'Conduct',
      questionGroup: 'Opening',
      text: 'Greeted?',
      answer: 'No',
      actions: [],
    },
  ]);
});
