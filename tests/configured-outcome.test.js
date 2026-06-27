// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeConfiguredOutcome,
  normaliseConfiguredActions,
} from '../src/evaluators/configured-outcome.js';

test('computeConfiguredOutcome: uses question no-action outcome when failed answer has no selected actions', () => {
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
  const questions = [
    {
      id: 'q1',
      text: 'Was disclosure made?',
      responseType: /** @type {const} */ ('yes-no-na'),
      failureCriteria: 'No',
      outcome: {
        noAction: { verdict: 'fail', wording: 'Fail', rank: 100 },
      },
      deprecated: false,
    },
  ];

  const result = computeConfiguredOutcome(questions, {
    q1: { value: 'No', remediationActions: [] },
  });

  assert.deepEqual(result, { verdict: 'fail', wording: 'Fail' });
});

test('computeConfiguredOutcome: uses selected action outcome wording', () => {
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
  const questions = [
    {
      id: 'q1',
      text: 'Was disclosure made?',
      responseType: /** @type {const} */ ('yes-no-na'),
      failureCriteria: 'No',
      outcome: {
        noAction: { verdict: 'fail', wording: 'Fail', rank: 100 },
      },
      remediationActions: [
        {
          id: 'impact',
          text: 'Customer impact identified',
          outcome: { verdict: 'fail', wording: 'Fail with impact', rank: 120 },
        },
        {
          id: 'feedback',
          text: 'Coaching feedback only',
          outcome: {
            verdict: 'pass',
            wording: 'Pass with feedback',
            rank: 20,
          },
        },
      ],
      deprecated: false,
    },
  ];

  const result = computeConfiguredOutcome(questions, {
    q1: {
      value: 'No',
      remediationActions: [
        { id: 'feedback', text: 'Coaching feedback only', completed: false },
      ],
    },
  });

  assert.deepEqual(result, {
    verdict: 'pass',
    wording: 'Pass with feedback',
  });
});

test('computeConfiguredOutcome: chooses highest ranked selected action outcome', () => {
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
  const questions = [
    {
      id: 'q1',
      text: 'Was disclosure made?',
      responseType: /** @type {const} */ ('yes-no-na'),
      failureCriteria: 'No',
      remediationActions: [
        {
          id: 'feedback',
          text: 'Coaching feedback only',
          outcome: {
            verdict: 'pass',
            wording: 'Pass with feedback',
            rank: 20,
          },
        },
        {
          id: 'impact',
          text: 'Customer impact identified',
          outcome: { verdict: 'fail', wording: 'Fail with impact', rank: 120 },
        },
      ],
      deprecated: false,
    },
  ];

  const result = computeConfiguredOutcome(questions, {
    q1: {
      value: 'No',
      remediationActions: [
        { id: 'feedback', text: 'Coaching feedback only', completed: false },
        { id: 'impact', text: 'Customer impact identified', completed: false },
      ],
    },
  });

  assert.deepEqual(result, {
    verdict: 'fail',
    wording: 'Fail with impact',
  });
});

test('computeConfiguredOutcome: ignores questions with no failureCriteria', () => {
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
  const questions = [
    {
      id: 'q-info',
      text: 'Was context reviewed?',
      category: 'General',
      responseType: /** @type {const} */ ('yes-no-na'),
      deprecated: false,
    },
  ];

  const result = computeConfiguredOutcome(questions, {
    'q-info': { value: 'No' },
  });

  assert.deepEqual(result, { verdict: 'pass', wording: 'Pass' });
});

test('normaliseConfiguredActions: preserves object actions and adds legacy ids', () => {
  assert.deepEqual(
    normaliseConfiguredActions(
      [
        'Legacy action',
        {
          id: 'stable',
          text: 'Stable action',
          outcome: { verdict: 'refer', wording: 'Refer', rank: 50 },
        },
      ],
      'q1'
    ),
    [
      { id: 'q1-ra-0', text: 'Legacy action' },
      {
        id: 'stable',
        text: 'Stable action',
        outcome: { verdict: 'refer', wording: 'Refer', rank: 50 },
      },
    ]
  );
});
