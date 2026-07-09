// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bankFromCaseTypeConfig,
  loadQuestionBanks,
  questionBanks,
} from '../src/question-bank/question-bank-source.js';
import { compileBank } from '../src/question-bank/question-bank-compile.js';

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

test('bankFromCaseTypeConfig: keeps runtime case type fields out of the editable bank', () => {
  const bank = bankFromCaseTypeConfig(
    'ops-review',
    /** @type {any} */ ({
      eligibleGroups: ['Reviewers'],
      questions: [],
      labels: [],
      outcomeOptions: [],
      defaultOutcomeId: 'pass',
      computeOutcome: () => ({ outcome: 'pass' }),
      sections: [{ id: 'summary', label: 'Summary' }],
      listName: 'Cases',
      slaHours: 72,
      captureGroups: ['Intake'],
      detailFields: [{ id: 'customer', label: 'Customer' }],
      appeal: { enabled: true },
      attributeFailures: true,
    })
  );

  assert.deepEqual(Object.keys(bank).sort(), [
    'defaultOutcomeId',
    'eligibleGroups',
    'label',
    'labels',
    'outcomeOptions',
    'questions',
    'slug',
  ]);
  assert.equal('computeOutcome' in bank, false);
  assert.equal('sections' in bank, false);
  assert.equal('listName' in bank, false);
  assert.equal('slaHours' in bank, false);
  assert.equal('captureGroups' in bank, false);
  assert.equal('detailFields' in bank, false);
  assert.equal('appeal' in bank, false);
  assert.equal('attributeFailures' in bank, false);
});

test('bankFromCaseTypeConfig: projects compileBank output back to the editable bank contract', async () => {
  const sourceBank =
    /** @type {import('../src/question-bank/question-bank-source.js').QuestionBank} */ ({
      label: 'Compiled Review',
      slug: 'compiled-review',
      eligibleGroups: ['Reviewers'],
      labels: [{ id: 'lbl-a', name: 'Alpha', color: '#111111' }],
      outcomeOptions: [
        { id: 'pass', wording: 'Pass', severity: 0 },
        { id: 'fail', wording: 'Fail', severity: 100 },
      ],
      defaultOutcomeId: 'pass',
      questions: [
        {
          id: 'q-a',
          text: 'A?',
          category: 'General',
          labelIds: ['lbl-a'],
          responseType: 'yes-no-na',
          optionOutcomes: { No: 'fail' },
          failureCriteria: 'No',
          deprecated: false,
        },
      ],
    });
  const compiledSource = compileBank(sourceBank).replace(
    `../src/evaluators/configured-outcome.js`,
    new URL('../src/evaluators/configured-outcome.js', import.meta.url).href
  );
  const { default: compiledConfig } = await import(
    `data:text/javascript,${encodeURIComponent(compiledSource)}`
  );

  const roundTripped = bankFromCaseTypeConfig(sourceBank.slug, compiledConfig);

  assert.deepEqual(roundTripped, sourceBank);
});

test('loadQuestionBanks: builds the bank map from importer entries', async () => {
  const banks = await loadQuestionBanks({
    alpha: async () => ({
      default:
        /** @type {import('../src/sharepoint-client.js').CaseTypeConfig} */ ({
          eligibleGroups: ['Reviewers'],
          outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
          questions: [
            {
              id: 'q-alpha',
              text: 'Alpha?',
              responseType: 'yes-no-na',
              deprecated: false,
            },
          ],
          computeOutcome: () => ({ outcome: 'pass' }),
        }),
    }),
    beta: async () => ({
      default:
        /** @type {import('../src/sharepoint-client.js').CaseTypeConfig} */ ({
          eligibleGroups: ['Owners'],
          outcomeOptions: [{ id: 'fail', wording: 'Fail', severity: 100 }],
          questions: [
            {
              id: 'q-beta',
              text: 'Beta?',
              responseType: 'single-choice',
              options: ['A', 'B'],
              deprecated: false,
            },
          ],
          computeOutcome: () => ({ outcome: 'fail' }),
        }),
    }),
  });

  assert.deepEqual(Object.keys(banks), ['alpha', 'beta']);
  assert.equal(banks.alpha.questions[0].id, 'q-alpha');
  assert.equal(banks.beta.eligibleGroups[0], 'Owners');
});

test('questionBanks: every live case type carries label definitions', () => {
  for (const [slug, bank] of Object.entries(questionBanks)) {
    assert.ok(
      (bank.labels ?? []).length > 0,
      `${slug} should define reporting labels`
    );
  }
});

test('questionBanks: every question labelId resolves within its case type', () => {
  for (const [slug, bank] of Object.entries(questionBanks)) {
    const labelIds = new Set((bank.labels ?? []).map((label) => label.id));
    for (const question of bank.questions) {
      for (const labelId of question.labelIds ?? []) {
        assert.ok(
          labelIds.has(labelId),
          `${slug}/${question.id} references missing label ${labelId}`
        );
      }
    }
  }
});
