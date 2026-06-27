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
    [{ id: 'fail', wording: 'Fail', severity: 100 }]
  );

  assert.deepEqual(result, { outcome: 'fail', wording: 'Fail' });
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
      { id: 'fail', wording: 'Fail', severity: 100 },
      { id: 'impact', wording: 'Fail with impact', severity: 120 },
      {
        id: 'feedback',
        wording: 'Pass with feedback',
        severity: 20,
      },
    ]
  );

  assert.deepEqual(result, {
    outcome: 'feedback',
    wording: 'Pass with feedback',
  });
});

test('computeConfiguredOutcome: chooses highest severity selected action outcome', () => {
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
        wording: 'Pass with feedback',
        severity: 20,
      },
      { id: 'impact', wording: 'Fail with impact', severity: 120 },
    ]
  );

  assert.deepEqual(result, {
    outcome: 'impact',
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

  assert.deepEqual(result, { outcome: 'pass', wording: 'Pass' });
});

test('computeConfiguredOutcome: uses configured default outcome when nothing fails', () => {
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
  const questions = [
    {
      id: 'q1',
      text: 'Was disclosure made?',
      responseType: /** @type {const} */ ('yes-no-na'),
      failureCriteria: 'No',
      deprecated: false,
    },
  ];

  const result = computeConfiguredOutcome(
    questions,
    { q1: { value: 'Yes' } },
    [{ id: 'good', wording: 'Good Outcome', severity: 0 }],
    'good'
  );

  assert.deepEqual(result, { outcome: 'good', wording: 'Good Outcome' });
});

test('computeConfiguredOutcome: failed outcomes can override the configured default by severity', () => {
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

  const result = computeConfiguredOutcome(
    questions,
    { q1: { value: 'No' } },
    [
      { id: 'good', wording: 'Good Outcome', severity: 0 },
      { id: 'fail', wording: 'Fail', severity: 100 },
    ],
    'good'
  );

  assert.deepEqual(result, { outcome: 'fail', wording: 'Fail' });
});

test('computeConfiguredOutcome: outcome options without severity default to zero', () => {
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
    { id: 'fail', wording: 'Fail' },
  ]);

  assert.deepEqual(result, { outcome: 'fail', wording: 'Fail' });
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
        noAction: { outcome: 'fail', wording: 'Fail', severity: 100 },
      },
      deprecated: false,
    },
  ];

  const result = computeConfiguredOutcome(questions, {
    q1: { value: 'No' },
  });

  assert.deepEqual(result, { outcome: 'fail', wording: 'Fail' });
});

test('normaliseConfiguredActions: preserves object actions and adds legacy ids', () => {
  assert.deepEqual(
    normaliseConfiguredActions(
      [
        'Legacy action',
        {
          id: 'stable',
          text: 'Stable action',
          outcome: { outcome: 'refer', wording: 'Refer', severity: 50 },
        },
      ],
      'q1'
    ),
    [
      { id: 'q1-ra-0', text: 'Legacy action' },
      {
        id: 'stable',
        text: 'Stable action',
        outcome: { outcome: 'refer', wording: 'Refer', severity: 50 },
      },
    ]
  );
});
