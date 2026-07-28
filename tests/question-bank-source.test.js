// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadQuestionBanks,
  normaliseQuestionBank,
} from '../src/pages/question-bank/question-bank-source.js';
import { compileBank } from '../src/pages/question-bank/question-bank-compile.js';

test('compileBank: emits the standalone editable bank artifact', () => {
  const sourceBank =
    /** @type {import('../src/pages/question-bank/question-bank-source.js').QuestionBank} */ ({
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

          deprecated: false,
        },
      ],
    });

  const compiled = JSON.parse(compileBank(sourceBank));

  assert.deepEqual(compiled, sourceBank);
});

test('normaliseQuestionBank: defaults omitted bank fields and deep-clones editable arrays', () => {
  const source =
    /** @type {import('../src/pages/question-bank/question-bank-source.js').QuestionBank} */ ({
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
  const { banks, failures } = await loadQuestionBanks({
    alpha: async () => ({
      default:
        /** @type {import('../src/pages/question-bank/question-bank-source.js').QuestionBank} */ ({
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
        /** @type {import('../src/pages/question-bank/question-bank-source.js').QuestionBank} */ ({
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
  assert.deepEqual(failures, []);
});

test('loadQuestionBanks: a broken artifact costs its own bank, not the others', async () => {
  const { banks, failures } = await loadQuestionBanks({
    alpha: async () => ({
      default:
        /** @type {import('../src/pages/question-bank/question-bank-source.js').QuestionBank} */ ({
          label: 'Alpha',
          slug: 'alpha',
          questions: [],
        }),
    }),
    broken: async () => {
      throw new Error('404 loading bank');
    },
    alsoBroken: async () => {
      throw 'not an Error';
    },
  });

  assert.deepEqual(Object.keys(banks), ['alpha']);
  assert.deepEqual(failures, [
    { slug: 'broken', message: '404 loading bank' },
    { slug: 'alsoBroken', message: 'not an Error' },
  ]);
});

test('loadQuestionBanks: a retry loads only the slugs it is given', async () => {
  /** @type {string[]} */
  const ran = [];
  /** @param {string} slug */
  const importer = (slug) => async () => {
    ran.push(slug);
    return {
      default:
        /** @type {import('../src/pages/question-bank/question-bank-source.js').QuestionBank} */ ({
          label: slug,
          slug,
          questions: [],
        }),
    };
  };

  const { banks, failures } = await loadQuestionBanks(
    { alpha: importer('alpha'), beta: importer('beta') },
    ['beta']
  );

  assert.deepEqual(ran, ['beta']);
  assert.deepEqual(Object.keys(banks), ['beta']);
  assert.deepEqual(failures, []);
});

test('loadQuestionBanks: a named slug with no importer is reported, not dropped', async () => {
  // A retry that silently ignored the slug it was asked about would clear the
  // failure banner while nothing had been recovered.
  const { banks, failures } = await loadQuestionBanks({}, ['ghost']);

  assert.deepEqual(banks, {});
  // The message is the curator-facing text in the failure banner, so it is
  // pinned: calling the missing importer would surface the raw
  // `importers[slug] is not a function` TypeError instead.
  assert.deepEqual(failures, [
    {
      slug: 'ghost',
      message: 'No Question Bank importer registered for "ghost"',
    },
  ]);
});

// The "importing this module performs no I/O" contract is enforced by
// tests/question-bank-import-io-contract.test.js, which imports the module in a
// child process with the real bank-reading primitives counted. A source-text
// assertion cannot do it: a rename, a parenthesised `await`, or a split
// statement walks straight past one.

test('questionBanks: every live case type carries label definitions', async () => {
  const { banks } = await loadQuestionBanks();
  for (const [slug, bank] of Object.entries(banks)) {
    assert.ok(
      (bank.labels ?? []).length > 0,
      `${slug} should define reporting labels`
    );
  }
});

test('questionBanks: every question labelId resolves within its case type', async () => {
  const { banks } = await loadQuestionBanks();
  for (const [slug, bank] of Object.entries(banks)) {
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
