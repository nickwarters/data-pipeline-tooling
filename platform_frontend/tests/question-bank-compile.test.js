// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  compileBank,
  highlight,
  escapeHtml,
  hashStr,
  compileExport,
  buildPublishArtifacts,
  publishBankEffect,
} from '../src/pages/question-bank/question-bank-compile.js';
import { mintBankVersion } from '../src/lib/bank-version.js';

/** Tiny helper to build a bank with one question. */
function bank(/** @type {any} */ q) {
  return { label: 'L', slug: 's', questions: [q] };
}

test('escapeHtml: escapes the five entities', () => {
  assert.equal(
    escapeHtml('<a href="x">&\'</a>'),
    '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;'
  );
});

test('escapeHtml: coerces non-string to string', () => {
  assert.equal(escapeHtml(/** @type {any} */ (123)), '123');
});

test('compileBank: emits standalone current bank JSON', () => {
  const out = compileBank({
    label: 'L',
    slug: 's',
    questions: [
      { id: 'q1', text: 'T', responseType: 'yes-no-na', deprecated: false },
    ],
  });
  assert.deepEqual(JSON.parse(out), {
    label: 'L',
    slug: 's',
    questions: [
      { id: 'q1', text: 'T', responseType: 'yes-no-na', deprecated: false },
    ],
  });
});

test('compileBank: includes bank metadata and question content only', () => {
  const out = compileBank({
    label: 'L',
    slug: 's',
    outcomeOptions: [
      { id: 'pass', wording: 'Pass', severity: 0 },
      { id: 'fail', wording: 'Fail', severity: 100 },
    ],
    defaultOutcomeId: 'pass',
    questions: [
      {
        id: 'q-general-info',
        text: 'Was the case context reviewed?',
        category: 'General',
        responseType: 'yes-no-na',
        deprecated: false,
      },
      {
        id: 'q-required-check',
        text: 'Was the required check completed?',
        responseType: 'yes-no-na',
        optionOutcomes: { No: 'fail' },
        labelIds: ['lbl-a'],
        remediationActions: ['Customer impact identified'],
        disallowFreeFormRemediation: true,
        deprecated: false,
      },
    ],
    labels: [{ id: 'lbl-a', name: 'Alpha', color: '#123456' }],
  });
  const parsed = JSON.parse(out);
  assert.deepEqual(parsed.outcomeOptions, [
    { id: 'pass', wording: 'Pass', severity: 0 },
    { id: 'fail', wording: 'Fail', severity: 100 },
  ]);
  assert.equal(parsed.defaultOutcomeId, 'pass');
  assert.deepEqual(parsed.labels, [
    { id: 'lbl-a', name: 'Alpha', color: '#123456' },
  ]);
  assert.deepEqual(parsed.questions[1], {
    id: 'q-required-check',
    text: 'Was the required check completed?',
    responseType: 'yes-no-na',
    optionOutcomes: { No: 'fail' },
    labelIds: ['lbl-a'],
    remediationActions: ['Customer impact identified'],
    disallowFreeFormRemediation: true,
    deprecated: false,
  });
  assert.equal(
    'disallowFreeFormRemediation' in parsed.questions[0],
    false,
    'a question with no opt-out stamps no free-form key into the artifact'
  );
  assert.equal('eligibleGroups' in parsed, false);
  assert.equal('computeOutcome' in parsed, false);
});

test('compileBank: outcome-type questions bake derived options and mappings', () => {
  const out = compileBank({
    label: 'L',
    slug: 's',
    outcomeOptions: [
      { id: 'pass', wording: 'Pass', severity: 0 },
      { id: 'fail', wording: 'Fail', severity: 100 },
    ],
    questions: [
      {
        id: 'q-outcome',
        text: 'Overall outcome',
        responseType: 'outcome',
        deprecated: false,
      },
    ],
  });

  assert.deepEqual(JSON.parse(out).questions[0], {
    id: 'q-outcome',
    text: 'Overall outcome',
    responseType: 'outcome',
    deprecated: false,
    options: ['Pass', 'Fail'],
    optionOutcomes: { Pass: 'pass', Fail: 'fail' },
  });
});

test('compileBank: preserves edited question order', () => {
  const out = compileBank({
    label: 'L',
    slug: 's',
    questions: [
      {
        id: 'q-third',
        text: 'Third',
        responseType: 'yes-no-na',
        deprecated: false,
      },
      {
        id: 'q-first',
        text: 'First',
        responseType: 'yes-no-na',
        deprecated: false,
      },
    ],
  });

  assert.deepEqual(
    JSON.parse(out).questions.map((/** @type {any} */ q) => q.id),
    ['q-third', 'q-first']
  );
});

test('compileBank: omits empty optional tables', () => {
  const out = compileBank({
    label: 'L',
    slug: 's',
    labels: [],
    outcomeOptions: [],
    questions: [],
  });
  const parsed = JSON.parse(out);
  assert.equal('labels' in parsed, false);
  assert.equal('outcomeOptions' in parsed, false);
  assert.deepEqual(parsed.questions, []);
});

test('highlight: wraps comments, strings, keywords, booleans, and property keys', () => {
  const code = `const x = 'hi'; // comment\nreturn true;\nconst obj = { key: 1 };`;
  const out = highlight(code);
  const classesByText = new Map(
    [...out.matchAll(/<span class="([^"]+)">([^<]+)<\/span>/g)].map(
      ([, className, text]) => [text, className]
    )
  );
  const tokens = [
    '// comment',
    'const',
    'return',
    'true',
    'key',
    '&#39;hi&#39;',
  ];
  for (const token of tokens) assert.ok(classesByText.has(token), token);
  assert.equal(classesByText.get('const'), classesByText.get('return'));
  assert.equal(
    new Set(
      ['// comment', 'const', 'true', 'key', '&#39;hi&#39;'].map((token) =>
        classesByText.get(token)
      )
    ).size,
    5,
    'each token kind has a distinct styling hook'
  );
});

test('highlight: handles double-quoted strings', () => {
  const out = highlight('const x = "hi";');
  assert.match(out, /<span class="[^"]+">&quot;hi&quot;<\/span>/);
});

test('hashStr: returns 12 hex chars (6 bytes)', async () => {
  const h = await hashStr('hello world');
  assert.equal(h.length, 12);
  assert.match(h, /^[0-9a-f]{12}$/);
});

test('hashStr: deterministic for the same input', async () => {
  assert.equal(await hashStr('x'), await hashStr('x'));
});

// ── compileExport ───────────────────────────────────────────────────────────

/** Minimal bank fixture used by compileExport tests. */
const exportBank = {
  label: 'Hello Review',
  slug: 'hello-review',
  version: 'hello-v2',
  history: [
    { version: 'hello-v1', generatedAt: '2026-01-10T09:00:00.000Z' },
    { version: 'hello-v2', generatedAt: '2026-03-02T14:30:00.000Z' },
  ],
  eligibleGroups: ['Reviewers'],
  questions: [
    {
      id: 'q1',
      text: 'Was the agent polite?',
      category: 'Conduct',
      responseType: /** @type {const} */ ('yes-no-na'),
      optionOutcomes: { No: 'fail' },
      deprecated: false,
    },
    {
      id: 'q2',
      text: 'Which channel?',
      category: 'Context',
      responseType: /** @type {const} */ ('single-choice'),
      options: ['Phone', 'Email'],
      deprecated: false,
    },
  ],
};

test('compileExport: returns envelope with slug, label, generatedAt, version, questions', async () => {
  const result = await compileExport(exportBank);
  assert.ok('slug' in result);
  assert.ok('label' in result);
  assert.ok('generatedAt' in result);
  assert.ok('version' in result);
  assert.ok('questions' in result);
  assert.equal(result.slug, 'hello-review');
  assert.equal(result.label, 'Hello Review');
  assert.equal(result.questions.length, 2);
});

test('compileExport: preserves edited question order', async () => {
  const result = await compileExport({
    label: 'L',
    slug: 's',
    version: 'v1',
    eligibleGroups: [],
    questions: [
      {
        id: 'q-third',
        text: 'Third',
        responseType: /** @type {const} */ ('yes-no-na'),
        deprecated: false,
      },
      {
        id: 'q-first',
        text: 'First',
        responseType: /** @type {const} */ ('yes-no-na'),
        deprecated: false,
      },
    ],
  });

  assert.deepEqual(
    result.questions.map((q) => q.id),
    ['q-third', 'q-first']
  );
});

test('compileExport: generatedAt is a valid ISO-8601 string', async () => {
  const { generatedAt } = await compileExport(exportBank);
  assert.ok(
    !isNaN(Date.parse(generatedAt)),
    `Not a valid date: ${generatedAt}`
  );
  assert.match(generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test("compileExport: the version is the bank's declaration, never computed", async () => {
  // The envelope carries what the bank says its version is — a hand-entered
  // identifier is as good as a minted one, and recomputing anything here
  // would stamp Cases with a value no published file answers to.
  const { version } = await compileExport(exportBank);
  assert.equal(version, 'hello-v2');
});

test('compileExport: a bank declaring no version is refused, not silently hashed', async () => {
  const { version: _dropped, ...undeclared } = exportBank;
  await assert.rejects(
    () => compileExport(/** @type {any} */ (undeclared)),
    /declares no version/
  );
});

test('mintBankVersion: mints the full 64-hex digest, with no algorithm prefix', async () => {
  // No prefix: the minted value is stamped on a Case row and composed into a
  // filename, and a colon cannot appear in a SharePoint or Windows filename.
  assert.match(await mintBankVersion(exportBank), /^[0-9a-f]{64}$/);
});

test('mintBankVersion: same questions+slug, different label/version/history → same mint', async () => {
  // Only the published content is identity: renaming a bank, or the identifier
  // it happened to carry before, does not mint a different version.
  const bankA = { ...exportBank, label: 'Label A' };
  const bankB = {
    ...exportBank,
    label: 'Label B',
    version: 'something-else',
    history: [],
  };
  const [a, b] = await Promise.all([
    mintBankVersion(bankA),
    mintBankVersion(bankB),
  ]);
  assert.equal(a, b);
});

test('mintBankVersion: different questions → different mint', async () => {
  const bankA = { ...exportBank };
  const bankB = {
    ...exportBank,
    questions: [
      { ...exportBank.questions[0], text: 'Different text' },
      exportBank.questions[1],
    ],
  };
  const [a, b] = await Promise.all([
    mintBankVersion(bankA),
    mintBankVersion(bankB),
  ]);
  assert.notEqual(a, b);
});

test('mintBankVersion: different slug → different mint', async () => {
  const bankA = { ...exportBank, slug: 'slug-a' };
  const bankB = { ...exportBank, slug: 'slug-b' };
  const [a, b] = await Promise.all([
    mintBankVersion(bankA),
    mintBankVersion(bankB),
  ]);
  assert.notEqual(a, b);
});

test('mintBankVersion: outcomeOptions affect the mint', async () => {
  const bankA = {
    ...exportBank,
    outcomeOptions: [{ id: 'fail', wording: 'Fail', severity: 100 }],
  };
  const bankB = {
    ...exportBank,
    outcomeOptions: [
      {
        id: 'fail',
        wording: 'Fail with impact',
        severity: 100,
      },
    ],
  };
  const [a, b] = await Promise.all([
    mintBankVersion(bankA),
    mintBankVersion(bankB),
  ]);
  assert.notEqual(a, b);
});

test('mintBankVersion: defaultOutcomeId affects the mint', async () => {
  const bankA = {
    ...exportBank,
    outcomeOptions: [{ id: 'good', wording: 'Good Outcome', severity: 0 }],
    defaultOutcomeId: 'good',
  };
  const bankB = {
    ...exportBank,
    outcomeOptions: [{ id: 'good', wording: 'Good Outcome', severity: 0 }],
    defaultOutcomeId: null,
  };
  const [a, b] = await Promise.all([
    mintBankVersion(bankA),
    mintBankVersion(/** @type {any} */ (bankB)),
  ]);
  assert.notEqual(a, b);
});

test('compileExport: carries defaultOutcomeId in the envelope', async () => {
  const result = await compileExport({
    ...exportBank,
    outcomeOptions: [{ id: 'good', wording: 'Good Outcome', severity: 0 }],
    defaultOutcomeId: 'good',
  });

  assert.equal(result.defaultOutcomeId, 'good');
});

test('mintBankVersion: key order in question objects does not affect the mint', async () => {
  const q = exportBank.questions[0];
  const qReordered = {
    text: q.text,
    deprecated: q.deprecated,
    id: q.id,
    optionOutcomes: q.optionOutcomes,
    category: q.category,
    responseType: q.responseType,
  };
  const bankA = { ...exportBank };
  const bankB = {
    ...exportBank,
    questions: [qReordered, exportBank.questions[1]],
  };
  const [a, b] = await Promise.all([
    mintBankVersion(bankA),
    mintBankVersion(bankB),
  ]);
  assert.equal(a, b);
});

test('compileExport: excludes computeOutcome, disallowFreeFormRemediation, eligibleGroups', async () => {
  const bankWithExtras = {
    ...exportBank,
    questions: [
      {
        ...exportBank.questions[0],
        optionOutcomes: { No: 'fail' },
        remediationActions: [
          {
            id: 'fix-it',
            text: 'Fix it',
          },
        ],
        disallowFreeFormRemediation: true,
      },
      exportBank.questions[1],
    ],
    outcomeOptions: [
      {
        id: 'good',
        wording: 'Good Outcome',
        severity: 0,
      },
      {
        id: 'fail',
        wording: 'Fail',
        severity: 100,
      },
      {
        id: 'refer',
        wording: 'Refer',
        severity: 50,
      },
    ],
    defaultOutcomeId: 'good',
  };
  const result = await compileExport(bankWithExtras);
  assert.ok(!('computeOutcome' in result));
  assert.ok(!('eligibleGroups' in result));
  for (const q of result.questions) {
    assert.ok(!('disallowFreeFormRemediation' in q));
  }
  assert.deepEqual(result.questions[0].optionOutcomes, { No: 'fail' });
  // Actions carry only id/text — the response drives the outcome, not actions.
  assert.deepEqual(result.questions[0].remediationActions, [
    {
      id: 'fix-it',
      text: 'Fix it',
    },
  ]);
  assert.deepEqual(result.outcomeOptions, [
    { id: 'good', wording: 'Good Outcome', severity: 0 },
    { id: 'fail', wording: 'Fail', severity: 100 },
    { id: 'refer', wording: 'Refer', severity: 50 },
  ]);
  assert.equal(result.defaultOutcomeId, 'good');
});

test('compileExport: includes labelIds per question when present', async () => {
  const bankWithLabels = {
    ...exportBank,
    questions: [
      { ...exportBank.questions[0], labelIds: ['lbl-a', 'lbl-b'] },
      exportBank.questions[1],
    ],
  };
  const result = await compileExport(bankWithLabels);
  assert.deepEqual(result.questions[0].labelIds, ['lbl-a', 'lbl-b']);
  assert.ok(
    !('labelIds' in result.questions[1]),
    'question without labelIds has no labelIds field'
  );
});

test('compileExport: labelIds are omitted when absent or empty', async () => {
  const bankNoLabels = {
    ...exportBank,
    questions: [
      { ...exportBank.questions[0], labelIds: [] },
      exportBank.questions[1],
    ],
  };
  const result = await compileExport(bankNoLabels);
  assert.ok(!('labelIds' in result.questions[0]));
  assert.ok(!('labelIds' in result.questions[1]));
});

test('mintBankVersion: labelIds on questions affect the mint', async () => {
  const bankA = { ...exportBank };
  const bankB = {
    ...exportBank,
    questions: [
      { ...exportBank.questions[0], labelIds: ['lbl-x'] },
      exportBank.questions[1],
    ],
  };
  const [a, b] = await Promise.all([
    mintBankVersion(bankA),
    mintBankVersion(bankB),
  ]);
  assert.notEqual(a, b);
});

test('compileExport: includes labels table in envelope', async () => {
  const bankWithLabels = {
    ...exportBank,
    labels: [
      { id: 'lbl-a', name: 'Alpha', color: '#ff0000' },
      { id: 'lbl-b', name: 'Beta', color: '#0000ff' },
    ],
  };
  const result = await compileExport(bankWithLabels);
  assert.deepEqual(result.labels, [
    { id: 'lbl-a', name: 'Alpha', color: '#ff0000' },
    { id: 'lbl-b', name: 'Beta', color: '#0000ff' },
  ]);
});

test('compileExport: labels table is empty array when bank has no labels', async () => {
  const result = await compileExport(exportBank);
  assert.deepEqual(result.labels, []);
});

test('compileExport: absent optional question fields are emitted as null', async () => {
  const minimalBank = {
    label: 'L',
    slug: 's',
    version: 'v1',
    eligibleGroups: [],
    questions: [
      {
        id: 'q1',
        text: 'T',
        responseType: /** @type {const} */ ('yes-no-na'),
        deprecated: false,
      },
    ],
  };
  const result = await compileExport(minimalBank);
  const q = result.questions[0];
  assert.equal(q.category, null);
  assert.equal(q.options, null);
  assert.equal(q.optionOutcomes, null);
  assert.equal(q.showWhen, null);
  assert.equal(q.remediationActions, null);
});

test('compileExport: present optional question fields are carried through', async () => {
  const result = await compileExport(exportBank);
  const q0 = result.questions[0];
  assert.equal(q0.category, 'Conduct');
  assert.deepEqual(q0.optionOutcomes, { No: 'fail' });
  const q1 = result.questions[1];
  assert.deepEqual(q1.options, ['Phone', 'Email']);
});

test('compileExport: showWhen is carried through when present', async () => {
  const bankWithShowWhen = {
    ...exportBank,
    questions: [
      { ...exportBank.questions[0], showWhen: { q0: { equals: 'Yes' } } },
      exportBank.questions[1],
    ],
  };
  const result = await compileExport(bankWithShowWhen);
  assert.deepEqual(result.questions[0].showWhen, { q0: { equals: 'Yes' } });
});

test('compileExport: deprecated true is preserved', async () => {
  const bankWithDeprecated = {
    ...exportBank,
    questions: [
      { ...exportBank.questions[0], deprecated: true },
      exportBank.questions[1],
    ],
  };
  const result = await compileExport(bankWithDeprecated);
  assert.equal(result.questions[0].deprecated, true);
});

test('mintBankVersion: empty questions array mints deterministically', async () => {
  const emptyBank = {
    label: 'L',
    slug: 'empty',
    eligibleGroups: [],
    questions: [],
  };
  const [a, b] = await Promise.all([
    mintBankVersion(emptyBank),
    mintBankVersion(emptyBank),
  ]);
  assert.equal(a, b);
});

// ── buildPublishArtifacts ───────────────────────────────────────────────────

const pubBank = {
  slug: 'test-review',
  label: 'Test Review',
  version: 'v2',
  history: [
    { version: 'v1', generatedAt: '2025-11-01T00:00:00.000Z' },
    { version: 'v2', generatedAt: '2026-01-10T09:00:00.000Z' },
  ],
  questions: [],
};

const pubEnvelope = {
  slug: 'test-review',
  label: 'Test Review',
  generatedAt: '2026-03-02T14:30:00.000Z',
  version: 'v3',
  questions: [],
};

test('buildPublishArtifacts: a new version writes its copy and advances the bank', () => {
  const result = buildPublishArtifacts(pubEnvelope, pubBank);

  assert.equal(result.isNew, true);
  assert.equal(result.versionedJson, JSON.stringify(pubEnvelope, null, 2));
  const bank = JSON.parse(result.bankJson);
  assert.equal(bank.version, 'v3');
  assert.deepEqual(bank.history, [
    ...pubBank.history,
    { version: 'v3', generatedAt: pubEnvelope.generatedAt },
  ]);
});

test('buildPublishArtifacts: a bank with no history starts one', () => {
  const { history: _none, ...unpublished } = pubBank;
  const result = buildPublishArtifacts(pubEnvelope, unpublished);

  assert.equal(result.isNew, true);
  assert.deepEqual(JSON.parse(result.bankJson).history, [
    { version: 'v3', generatedAt: pubEnvelope.generatedAt },
  ]);
});

test('buildPublishArtifacts: labels are published only in the bank, not the version', () => {
  // Label name/color is presentation, resolved from the current bank so a
  // rename applies across every historical report; the per-question labelIds
  // stay frozen in the versioned copy.
  const labels = [{ id: 'lbl-a', name: 'Alpha', color: '#ff0000' }];
  const result = buildPublishArtifacts(
    { ...pubEnvelope, labels },
    { ...pubBank, labels }
  );

  assert.ok(result.versionedJson);
  assert.ok(!('labels' in JSON.parse(result.versionedJson)));
  assert.deepEqual(JSON.parse(result.bankJson).labels, labels);
});

test('buildPublishArtifacts: a version already in the history re-publishes nothing', () => {
  const result = buildPublishArtifacts(
    { ...pubEnvelope, version: 'v2' },
    pubBank
  );

  assert.equal(result.isNew, false);
  assert.equal(result.versionedJson, null);
  const bank = JSON.parse(result.bankJson);
  assert.equal(bank.version, 'v2');
  assert.deepEqual(bank.history, pubBank.history);
});

test('buildPublishArtifacts: does not mutate the bank it was handed', () => {
  const bank = structuredClone(pubBank);
  buildPublishArtifacts(pubEnvelope, bank);
  assert.deepEqual(bank, pubBank);
});

test('publishBankEffect mints a new version for the edited bank and writes through the compiler path', async () => {
  /** @type {any[]} */
  const writes = [];
  const minted = await mintBankVersion(/** @type {any} */ (exportBank));

  const artifacts = await publishBankEffect(
    /** @type {any} */ (exportBank),
    async (payload) => {
      writes.push(payload);
    }
  );

  assert.equal(writes.length, 1);
  assert.equal(writes[0], artifacts);
  assert.equal(artifacts.isNew, true);
  assert.ok(artifacts.versionedJson);
  const versioned = JSON.parse(artifacts.versionedJson);
  assert.equal(versioned.version, minted);
  const bank = JSON.parse(artifacts.bankJson);
  assert.equal(bank.version, minted);
  assert.equal(bank.history.at(-1).version, minted);
});
