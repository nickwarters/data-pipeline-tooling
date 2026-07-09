// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bankFromCaseTypeConfig } from '../src/question-bank/question-bank-source.js';

test('bankFromCaseTypeConfig: projects case type config into editable bank shape', () => {
  const config =
    /** @type {import('../src/sharepoint-client.js').CaseTypeConfig} */ ({
      eligibleGroups: ['Reviewers'],
      labels: [{ id: 'lbl-a', name: 'Alpha', color: '#111111' }],
      outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
      defaultOutcomeId: 'pass',
      questions: [
        {
          id: 'q-a',
          text: 'A?',
          category: 'General',
          labelIds: ['lbl-a'],
          responseType: 'yes-no-na',
          deprecated: false,
        },
      ],
      computeOutcome: () => ({ outcome: 'pass' }),
    });

  const bank = bankFromCaseTypeConfig('example-review', config);

  assert.equal(bank.slug, 'example-review');
  assert.equal(bank.label, 'Example Review');
  assert.deepEqual(bank.eligibleGroups, ['Reviewers']);
  assert.deepEqual(bank.labels, [
    { id: 'lbl-a', name: 'Alpha', color: '#111111' },
  ]);
  assert.deepEqual(bank.outcomeOptions, [
    { id: 'pass', wording: 'Pass', severity: 0 },
  ]);
  assert.equal(bank.defaultOutcomeId, 'pass');
  assert.deepEqual(bank.questions, [
    {
      id: 'q-a',
      text: 'A?',
      category: 'General',
      labelIds: ['lbl-a'],
      responseType: 'yes-no-na',
      deprecated: false,
    },
  ]);
});

test('bankFromCaseTypeConfig: defaults omitted bank fields', () => {
  const bank = bankFromCaseTypeConfig(
    'minimal-review',
    /** @type {any} */ ({
      computeOutcome: () => ({ outcome: 'pass' }),
      questions: [
        {
          id: 'q-a',
          text: 'A?',
          responseType: 'yes-no-na',
        },
      ],
    })
  );

  assert.deepEqual(bank, {
    label: 'Minimal Review',
    slug: 'minimal-review',
    eligibleGroups: [],
    labels: [],
    outcomeOptions: [],
    defaultOutcomeId: undefined,
    questions: [
      {
        id: 'q-a',
        text: 'A?',
        responseType: 'yes-no-na',
        deprecated: false,
      },
    ],
  });
});

test('bankFromCaseTypeConfig: defaults missing questions to an empty list', () => {
  const bank = bankFromCaseTypeConfig(
    'empty-review',
    /** @type {any} */ ({
      computeOutcome: () => ({ outcome: 'pass' }),
    })
  );

  assert.deepEqual(bank.questions, []);
});

test('bankFromCaseTypeConfig: deep-clones editable arrays', () => {
  const config =
    /** @type {import('../src/sharepoint-client.js').CaseTypeConfig} */ ({
      eligibleGroups: ['Reviewers'],
      labels: [{ id: 'lbl-a', name: 'Alpha', color: '#111111' }],
      outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
      questions: [
        {
          id: 'q-a',
          text: 'A?',
          responseType: 'yes-no-na',
          labelIds: ['lbl-a'],
          deprecated: false,
        },
      ],
      computeOutcome: () => ({ outcome: 'pass' }),
    });

  const bank = bankFromCaseTypeConfig('example-review', config);
  bank.eligibleGroups.push('Owners');
  bank.labels?.[0] && (bank.labels[0].name = 'Changed');
  bank.outcomeOptions?.[0] && (bank.outcomeOptions[0].wording = 'Changed');
  bank.questions[0].text = 'Changed?';
  bank.questions[0].labelIds?.push('lbl-b');

  assert.deepEqual(config.eligibleGroups, ['Reviewers']);
  assert.deepEqual(config.labels, [
    { id: 'lbl-a', name: 'Alpha', color: '#111111' },
  ]);
  assert.deepEqual(config.outcomeOptions, [
    { id: 'pass', wording: 'Pass', severity: 0 },
  ]);
  assert.deepEqual(config.questions, [
    {
      id: 'q-a',
      text: 'A?',
      responseType: 'yes-no-na',
      labelIds: ['lbl-a'],
      deprecated: false,
    },
  ]);
});
