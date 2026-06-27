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
        noActionOutcomeId: 'fail',
      },
      deprecated: false,
    },
  ];

  const result = computeConfiguredOutcome(
    questions,
    {
      q1: { value: 'No', remediationActions: [] },
    },
    [{ id: 'fail', verdict: 'fail', wording: 'Fail', rank: 100 }]
  );

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
        noActionOutcomeId: 'fail',
      },
      remediationActions: [
        {
          id: 'impact',
          text: 'Customer impact identified',
          outcomeId: 'impact',
        },
        {
          id: 'feedback',
          text: 'Coaching feedback only',
          outcomeId: 'feedback',
        },
      ],
      deprecated: false,
    },
  ];

  const result = computeConfiguredOutcome(
    questions,
    {
      q1: {
        value: 'No',
        remediationActions: [
          { id: 'feedback', text: 'Coaching feedback only', completed: false },
        ],
      },
    },
    [
      { id: 'fail', verdict: 'fail', wording: 'Fail', rank: 100 },
      { id: 'impact', verdict: 'fail', wording: 'Fail with impact', rank: 120 },
      {
        id: 'feedback',
        verdict: 'pass',
        wording: 'Pass with feedback',
        rank: 20,
      },
    ]
  );

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
          outcomeId: 'feedback',
        },
        {
          id: 'impact',
          text: 'Customer impact identified',
          outcomeId: 'impact',
        },
      ],
      deprecated: false,
    },
  ];

  const result = computeConfiguredOutcome(
    questions,
    {
      q1: {
        value: 'No',
        remediationActions: [
          { id: 'feedback', text: 'Coaching feedback only', completed: false },
          {
            id: 'impact',
            text: 'Customer impact identified',
            completed: false,
          },
        ],
      },
    },
    [
      {
        id: 'feedback',
        verdict: 'pass',
        wording: 'Pass with feedback',
        rank: 20,
      },
      { id: 'impact', verdict: 'fail', wording: 'Fail with impact', rank: 120 },
    ]
  );

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

test('computeConfiguredOutcome: unranked outcome options default by semantic verdict', () => {
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
  const questions = [
    {
      id: 'q1',
      text: 'Was disclosure made?',
      responseType: /** @type {const} */ ('yes-no-na'),
      failureCriteria: 'No',
      outcome: { noActionOutcomeId: 'fail' },
      deprecated: false,
    },
  ];

  const result = computeConfiguredOutcome(questions, { q1: { value: 'No' } }, [
    { id: 'fail', verdict: 'fail', wording: 'Fail' },
  ]);

  assert.deepEqual(result, { verdict: 'fail', wording: 'Fail' });
});

test('computeConfiguredOutcome: falls back to legacy embedded descriptors', () => {
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
    q1: { value: 'No' },
  });

  assert.deepEqual(result, { verdict: 'fail', wording: 'Fail' });
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
