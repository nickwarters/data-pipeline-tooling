// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeConfiguredOutcome,
  normaliseConfiguredActions,
  outcomeResponseOptions,
  validateConfiguredOutcomeConfig,
} from '../src/evaluators/configured-outcome.js';

const PASS_REFER_FAIL = [
  { id: 'pass', wording: 'Pass', severity: 0 },
  { id: 'refer', wording: 'Refer', severity: 50 },
  { id: 'fail', wording: 'Fail', severity: 100 },
];

test('computeConfiguredOutcome: returns only the configured default outcome id when nothing is answered', () => {
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
  const questions = [
    {
      id: 'q1',
      text: 'Was disclosure made?',
      responseType: /** @type {const} */ ('yes-no-na'),
      optionOutcomes: { No: 'fail' },
      deprecated: false,
    },
  ];

  const result = computeConfiguredOutcome(
    questions,
    {},
    PASS_REFER_FAIL,
    'pass'
  );

  assert.deepEqual(result, { outcome: 'pass' });
});

test('computeConfiguredOutcome: a selected option maps to its configured outcome', () => {
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
  const questions = [
    {
      id: 'q1',
      text: 'Was disclosure made?',
      responseType: /** @type {const} */ ('yes-no-na'),
      optionOutcomes: { Yes: 'pass', No: 'fail' },
      deprecated: false,
    },
  ];

  const result = computeConfiguredOutcome(
    questions,
    { q1: { value: 'No' } },
    PASS_REFER_FAIL,
    'pass'
  );

  assert.deepEqual(result, { outcome: 'fail' });
});

test('computeConfiguredOutcome: highest-scoring applicable outcome wins across questions', () => {
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
  const questions = [
    {
      id: 'q1',
      text: 'Q1',
      responseType: /** @type {const} */ ('single-choice'),
      options: ['Ok', 'Minor'],
      optionOutcomes: { Ok: 'pass', Minor: 'refer' },
      deprecated: false,
    },
    {
      id: 'q2',
      text: 'Q2',
      responseType: /** @type {const} */ ('yes-no-na'),
      options: ['Yes', 'No', 'NA'],
      optionOutcomes: { No: 'fail' },
      deprecated: false,
    },
  ];

  const result = computeConfiguredOutcome(
    questions,
    { q1: { value: 'Minor' }, q2: { value: 'No' } },
    PASS_REFER_FAIL,
    'pass'
  );

  assert.deepEqual(result, { outcome: 'fail' });
});

test('computeConfiguredOutcome: multi-choice scores every selected option', () => {
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
  const questions = [
    {
      id: 'q1',
      text: 'Which breaches occurred?',
      responseType: /** @type {const} */ ('multi-choice'),
      options: ['Late', 'Missing disclosure'],
      optionOutcomes: { Late: 'refer', 'Missing disclosure': 'fail' },
      deprecated: false,
    },
  ];

  const result = computeConfiguredOutcome(
    questions,
    { q1: { value: ['Late', 'Missing disclosure'] } },
    PASS_REFER_FAIL,
    'pass'
  );

  assert.deepEqual(result, { outcome: 'fail' });
});

test('computeConfiguredOutcome: uses the configured default outcome as the baseline', () => {
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
  const questions = [
    {
      id: 'q1',
      text: 'Q1',
      responseType: /** @type {const} */ ('yes-no-na'),
      deprecated: false,
    },
  ];

  const result = computeConfiguredOutcome(
    questions,
    { q1: { value: 'Yes' } },
    [{ id: 'good', wording: 'Good Outcome', severity: 0 }],
    'good'
  );

  assert.deepEqual(result, { outcome: 'good' });
});

test('computeConfiguredOutcome: a mapped response overrides the default by severity', () => {
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
  const questions = [
    {
      id: 'q1',
      text: 'Q1',
      responseType: /** @type {const} */ ('yes-no-na'),
      optionOutcomes: { No: 'fail' },
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

  assert.deepEqual(result, { outcome: 'fail' });
});

test('computeConfiguredOutcome: ignores questions without an option-outcome mapping', () => {
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
  const questions = [
    {
      id: 'q-info',
      text: 'Which channel?',
      responseType: /** @type {const} */ ('single-choice'),
      options: ['Phone', 'Email'],
      deprecated: false,
    },
  ];

  const result = computeConfiguredOutcome(
    questions,
    { 'q-info': { value: 'Phone' } },
    PASS_REFER_FAIL,
    'pass'
  );

  assert.deepEqual(result, { outcome: 'pass' });
});

test('validateConfiguredOutcomeConfig: rejects question mappings to unknown outcome ids', () => {
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
  const questions = [
    {
      id: 'q1',
      text: 'Q1',
      responseType: /** @type {const} */ ('single-choice'),
      options: ['A', 'B'],
      // A → unknown id, B → unmapped (absent)
      optionOutcomes: { A: 'ghost' },
      deprecated: false,
    },
  ];

  assert.throws(
    () => validateConfiguredOutcomeConfig(questions, PASS_REFER_FAIL, 'pass'),
    /unknown outcome id "ghost"/
  );
});

test('validateConfiguredOutcomeConfig: rejects missing outcome configuration instead of falling back', () => {
  assert.throws(
    () => validateConfiguredOutcomeConfig([], []),
    /outcomeOptions/
  );
  assert.throws(
    () => validateConfiguredOutcomeConfig([], PASS_REFER_FAIL),
    /defaultOutcomeId/
  );
  assert.throws(
    () => validateConfiguredOutcomeConfig([], PASS_REFER_FAIL, 'ghost'),
    /defaultOutcomeId "ghost"/
  );
});

test('validateConfiguredOutcomeConfig: rejects a missing questions array clearly', () => {
  assert.throws(
    () =>
      validateConfiguredOutcomeConfig(
        /** @type {any} */ (undefined),
        PASS_REFER_FAIL,
        'pass'
      ),
    /questions must be an array/
  );
});

test('validateConfiguredOutcomeConfig: accepts a complete valid configuration', () => {
  assert.doesNotThrow(() =>
    validateConfiguredOutcomeConfig([], PASS_REFER_FAIL, 'pass')
  );
});

test('validateConfiguredOutcomeConfig: rejects malformed outcome options', () => {
  const option = (/** @type {Record<string, unknown>} */ overrides) => [
    { id: 'pass', wording: 'Pass', severity: 0, ...overrides },
  ];

  for (const [outcomes, message] of [
    [/** @type {any} */ ([null]), /requires an id/],
    [/** @type {any} */ (option({ id: 42 })), /requires an id/],
    [option({ id: '' }), /requires an id/],
    [
      [
        { id: 'pass', wording: 'Pass', severity: 0 },
        { id: 'pass', wording: 'Again', severity: 1 },
      ],
      /duplicate outcome id "pass"/,
    ],
    [option({ wording: '' }), /requires wording/],
    [option({ wording: 42 }), /requires wording/],
    [option({ severity: Number.NaN }), /requires a finite severity/],
  ]) {
    assert.throws(
      () =>
        validateConfiguredOutcomeConfig(
          [],
          /** @type {any} */ (outcomes),
          'pass'
        ),
      /** @type {RegExp} */ (message)
    );
  }
});

test('OutcomeConfigurationError: exposes a stable error type and message', () => {
  assert.throws(
    () => validateConfiguredOutcomeConfig([], [], 'pass'),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, 'OutcomeConfigurationError');
      assert.match(
        error.message,
        /^Case Type outcome configuration is invalid:/
      );
      return true;
    }
  );
});

test('computeConfiguredOutcome: rejects an unconfigured default', () => {
  assert.throws(
    () => computeConfiguredOutcome([], {}, PASS_REFER_FAIL, 'ghost'),
    /defaultOutcomeId "ghost" is not configured/
  );
});

test('computeConfiguredOutcome: ignores empty, unmapped, and unknown mappings', () => {
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
  const questions = [
    {
      id: 'empty',
      text: 'Empty',
      responseType: 'single-choice',
      optionOutcomes: { No: 'fail' },
      deprecated: false,
    },
    {
      id: 'unmapped',
      text: 'Unmapped',
      responseType: 'single-choice',
      optionOutcomes: { No: 'fail' },
      deprecated: false,
    },
    {
      id: 'unknown',
      text: 'Unknown',
      responseType: 'single-choice',
      optionOutcomes: { No: 'ghost' },
      deprecated: false,
    },
  ];

  assert.deepEqual(
    computeConfiguredOutcome(
      questions,
      {
        empty: { value: '' },
        unmapped: { value: 'Yes' },
        unknown: { value: 'No' },
      },
      PASS_REFER_FAIL,
      'pass'
    ),
    { outcome: 'pass' }
  );
});

test('computeConfiguredOutcome: equal severity uses the later specific mapping', () => {
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
  const questions = [
    {
      id: 'q1',
      text: 'Q1',
      responseType: 'single-choice',
      optionOutcomes: { A: 'refer-a' },
      deprecated: false,
    },
    {
      id: 'q2',
      text: 'Q2',
      responseType: 'single-choice',
      optionOutcomes: { B: 'refer-b' },
      deprecated: false,
    },
  ];
  const outcomes = [
    { id: 'pass', wording: 'Pass', severity: 0 },
    { id: 'refer-a', wording: 'Refer A', severity: 50 },
    { id: 'refer-b', wording: 'Refer B', severity: 50 },
  ];

  assert.deepEqual(
    computeConfiguredOutcome(
      questions,
      { q1: { value: 'A' }, q2: { value: 'B' } },
      outcomes,
      'pass'
    ),
    { outcome: 'refer-b' }
  );
});

test('outcomeResponseOptions: derives read-only labels and mapping from the outcome vocabulary', () => {
  assert.deepEqual(outcomeResponseOptions(PASS_REFER_FAIL), {
    options: ['Pass', 'Refer', 'Fail'],
    optionOutcomes: { Pass: 'pass', Refer: 'refer', Fail: 'fail' },
  });
  assert.deepEqual(outcomeResponseOptions(), {
    options: [],
    optionOutcomes: {},
  });
});

test('computeConfiguredOutcome: an outcome-type response drives the outcome', () => {
  const { options, optionOutcomes } = outcomeResponseOptions(PASS_REFER_FAIL);
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
  const questions = [
    {
      id: 'q1',
      text: 'Overall assessment',
      responseType: /** @type {const} */ ('outcome'),
      options,
      optionOutcomes,
      deprecated: false,
    },
  ];

  const result = computeConfiguredOutcome(
    questions,
    { q1: { value: 'Refer' } },
    PASS_REFER_FAIL,
    'pass'
  );

  assert.deepEqual(result, { outcome: 'refer' });
});

test('normaliseConfiguredActions: coerces strings and strips any legacy outcome', () => {
  assert.deepEqual(
    normaliseConfiguredActions(
      /** @type {any} */ ([
        'Legacy action',
        {
          id: 'stable',
          text: 'Stable action',
          outcome: { outcome: 'refer', wording: 'Refer', severity: 50 },
        },
      ]),
      'q1'
    ),
    [
      { id: 'q1-ra-0', text: 'Legacy action' },
      { id: 'stable', text: 'Stable action' },
    ]
  );
});

test('computeConfiguredOutcome: an N/A Answer scores no Outcome and falls back to the default', () => {
  // N/A is absent from every optionOutcomes mapping (the editor never offers
  // one), so it must contribute nothing to the Outcome (#390 Part 2).
  const questions = [
    {
      id: 'q-na',
      text: 'Q',
      responseType: /** @type {const} */ ('outcome'),
      options: ['Pass', 'Fail'],
      optionOutcomes: { Pass: 'pass', Fail: 'fail' },
      deprecated: false,
    },
  ];
  const outcomeOptions = [
    { id: 'pass', wording: 'Pass', severity: 0 },
    { id: 'fail', wording: 'Fail', severity: 100 },
  ];
  const result = computeConfiguredOutcome(
    /** @type {any} */ (questions),
    { 'q-na': { value: 'NA' } },
    outcomeOptions,
    'pass'
  );
  assert.deepEqual(result, { outcome: 'pass' });
});

test('computeConfiguredOutcome: multi-choice N/A value scores no Outcome', () => {
  const questions = [
    {
      id: 'q-mc',
      text: 'Q',
      responseType: /** @type {const} */ ('multi-choice'),
      options: ['A'],
      optionOutcomes: { A: 'fail' },
      deprecated: false,
    },
  ];
  const outcomeOptions = [
    { id: 'pass', wording: 'Pass', severity: 0 },
    { id: 'fail', wording: 'Fail', severity: 100 },
  ];
  const result = computeConfiguredOutcome(
    /** @type {any} */ (questions),
    { 'q-mc': { value: ['NA'] } },
    outcomeOptions,
    'pass'
  );
  assert.deepEqual(result, { outcome: 'pass' });
});
