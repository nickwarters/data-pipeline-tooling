// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadQuestionBanks,
  normaliseQuestionBank,
  questionBanks,
} from '../src/question-bank/question-bank-source.js';
import { compileBank } from '../src/question-bank/question-bank-compile.js';

test('compileBank: emits the standalone editable bank artifact', () => {
  const sourceBank =
    /** @type {import('../src/question-bank/question-bank-source.js').QuestionBank} */ ({
      label: 'Compiled Review',
      slug: 'compiled-review',
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

  const compiled = JSON.parse(compileBank(sourceBank));

  assert.deepEqual(compiled, sourceBank);
});

test('normaliseQuestionBank: defaults omitted bank fields and deep-clones editable arrays', () => {
  const source =
    /** @type {import('../src/question-bank/question-bank-source.js').QuestionBank} */ ({
      label: 'Alpha',
      slug: 'alpha',
      questions: [
        {
          id: 'q-alpha',
          text: 'Alpha?',
          responseType: 'yes-no-na',
          /** @type {any} */
          deprecated: undefined,
        },
      ],
    });

  const bank = normaliseQuestionBank(source);
  bank.questions[0].text = 'Changed?';

  assert.deepEqual(bank, {
    label: 'Alpha',
    slug: 'alpha',
    labels: [],
    outcomeOptions: [],
    defaultOutcomeId: undefined,
    questions: [
      {
        id: 'q-alpha',
        text: 'Changed?',
        responseType: 'yes-no-na',
        deprecated: false,
      },
    ],
  });
  assert.equal(source.questions[0].text, 'Alpha?');
});

test('loadQuestionBanks: builds the bank map from standalone bank importer entries', async () => {
  const banks = await loadQuestionBanks({
    alpha: async () => ({
      default:
        /** @type {import('../src/question-bank/question-bank-source.js').QuestionBank} */ ({
          label: 'Alpha',
          slug: 'alpha',
          outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
          questions: [
            {
              id: 'q-alpha',
              text: 'Alpha?',
              responseType: 'yes-no-na',
              deprecated: false,
            },
          ],
        }),
    }),
    beta: async () => ({
      default:
        /** @type {import('../src/question-bank/question-bank-source.js').QuestionBank} */ ({
          label: 'Beta',
          slug: 'beta',
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
        }),
    }),
  });

  assert.deepEqual(Object.keys(banks), ['alpha', 'beta']);
  assert.equal(banks.alpha.questions[0].id, 'q-alpha');
  assert.equal(banks.beta.outcomeOptions?.[0].id, 'fail');
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
