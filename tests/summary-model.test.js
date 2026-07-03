// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

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
    category: 'Opening',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    deprecated: false,
  },
  {
    id: 'q-needs',
    text: 'Needs found?',
    category: 'Discovery',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    remediationActions: ['Retrain agent.'],
    deprecated: false,
  },
  {
    id: 'q-resolve',
    text: 'Resolved?',
    category: 'Discovery',
    responseType: 'yes-no-na',
    showWhen: { 'q-needs': { equals: 'Yes' } },
    failureCriteria: 'No',
    remediationActions: ['Escalate.', 'Follow up.'],
    deprecated: false,
  },
  // Informational (no failureCriteria) — excluded from pass/fail counts.
  {
    id: 'q-channel',
    text: 'Channel?',
    category: 'Opening',
    responseType: 'single-choice',
    options: ['Phone'],
    deprecated: false,
  },
];

test('buildSummaryModel: pass/fail counts per category over answered, applicable, failure-scorable questions', () => {
  const answers = /** @type {Record<string, Answer>} */ ({
    'q-open': { value: 'No' }, // Opening: fail
    'q-needs': { value: 'Yes' }, // Discovery: pass (also makes q-resolve applicable)
    'q-resolve': { value: 'No' }, // Discovery: fail
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
    {
      id: 'q-live',
      text: 'Live?',
      category: 'A',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      deprecated: false,
    },
    {
      id: 'q-old',
      text: 'Old?',
      category: 'A',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      deprecated: true,
    },
    {
      id: 'q-blank',
      text: 'Blank?',
      category: 'A',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      deprecated: false,
    },
  ];
  // q-live answered, q-old deprecated (dropped), q-blank applicable but unanswered.
  const model = buildSummaryModel(cat, { 'q-live': { value: 'Yes' } });
  assert.deepEqual(model.categoryCounts, [{ category: 'A', pass: 1, fail: 0 }]);
});

test('buildSummaryModel: remediationActionCount sums selected actions + free-form across failed answers (issue #250)', () => {
  const answers = /** @type {Record<string, Answer>} */ ({
    // failed, nothing selected but a free-form action → 1
    'q-open': { value: 'No', freeFormRemediation: 'Apologise to customer' },
    // failed with one selected canned action → 1 (q-resolve is now not applicable)
    'q-needs': {
      value: 'No',
      remediationActions: [
        { id: 'q-needs-ra-0', text: 'Retrain agent.', completed: false },
      ],
    },
  });
  const model = buildSummaryModel(catalogue, answers);
  assert.equal(model.remediationActionCount, 2);
});

test('buildSummaryModel: remediationActionCount is 0 when there are no failures', () => {
  const answers = /** @type {Record<string, Answer>} */ ({
    'q-open': { value: 'Yes' },
    'q-needs': { value: 'Yes' },
    'q-resolve': { value: 'Yes' },
  });
  assert.equal(buildSummaryModel(catalogue, answers).remediationActionCount, 0);
});

test('buildSummaryModel: failures list each failed Answer with its selected actions + free-form (issue #250)', () => {
  const answers = /** @type {Record<string, Answer>} */ ({
    'q-open': { value: 'No' }, // failed, nothing selected → no actions
    'q-needs': { value: 'Yes' },
    'q-resolve': {
      value: 'No',
      remediationActions: [
        { id: 'q-resolve-ra-0', text: 'Escalate.', completed: false },
      ],
      freeFormRemediation: 'Call back within 24h',
    },
  });
  const model = buildSummaryModel(catalogue, answers);
  assert.deepEqual(model.failures, [
    {
      id: 'q-open',
      category: 'Opening',
      text: 'Greeted?',
      answer: 'No',
      actions: [],
      sentActions: [],
    },
    {
      id: 'q-resolve',
      category: 'Discovery',
      text: 'Resolved?',
      answer: 'No',
      // Only the selected canned action, then the free-form entry — not the
      // question's full ['Escalate.', 'Follow up.'] catalogue.
      actions: ['Escalate.', 'Call back within 24h'],
      sentActions: [],
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
      failureCriteria: 'B',
      remediationActions: ['Fix B.'],
      deprecated: false,
    },
  ];
  const model = buildSummaryModel(cat, {
    'q-prod': {
      value: ['A', 'B'],
      remediationActions: [
        { id: 'q-prod-ra-0', text: 'Fix B.', completed: false },
      ],
    },
  });
  assert.deepEqual(model.failures, [
    {
      id: 'q-prod',
      category: undefined,
      text: 'Defects?',
      answer: 'A, B',
      actions: ['Fix B.'],
      sentActions: [],
    },
  ]);
});

test('buildSummaryModel: reads sent Remediation Actions from a failed Answer capture (ADR-0024)', () => {
  /** @type {QuestionDefinition[]} */
  const cat = [
    {
      id: 'q-prod',
      text: 'Defects?',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      deprecated: false,
    },
  ];
  /** @type {import('../src/sharepoint-client.js').CaptureGroup[]} */
  const captureGroups = [
    {
      key: 'g',
      label: 'G',
      fields: [{ key: 'acts', label: 'Actions', type: 'actions' }],
    },
  ];
  const model = buildSummaryModel(
    cat,
    {
      'q-prod': {
        value: 'No',
        capture: {
          acts: [
            'legacy action',
            { id: 'a2', text: 'done', status: 'complete' },
          ],
        },
      },
    },
    captureGroups
  );
  assert.deepEqual(model.failures[0].sentActions, [
    { id: 'acts-0', text: 'legacy action', status: 'pending' },
    { id: 'a2', text: 'done', status: 'complete' },
  ]);
});
