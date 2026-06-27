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
} from '../src/question-bank/question-bank-compile.js';

/** Tiny helper to build a bank with one question. */
function bank(/** @type {any} */ q) {
  return { label: 'L', slug: 's', eligibleGroups: ['G'], questions: [q] };
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

test('compileBank: emits header, eligibleGroups, computeOutcome, export', () => {
  const out = compileBank({
    label: 'L',
    slug: 's',
    eligibleGroups: ['Reviewers'],
    questions: [
      { id: 'q1', text: 'T', responseType: 'yes-no-na', deprecated: false },
    ],
  });
  assert.ok(out.startsWith('// @ts-check'));
  assert.ok(
    out.includes(
      `import { computeConfiguredOutcome } from '../src/evaluators/configured-outcome.js';`
    )
  );
  assert.ok(out.includes(`eligibleGroups: ["Reviewers"]`));
  assert.ok(out.includes('computeOutcome(answers)'));
  assert.ok(
    out.includes('return computeConfiguredOutcome(config.questions, answers);')
  );
  assert.ok(out.endsWith('export default config;'));
});

test('compileBank: default outcome is driven by failureCriteria, not raw No answers', async () => {
  const out = compileBank({
    label: 'L',
    slug: 's',
    eligibleGroups: ['Reviewers'],
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
        failureCriteria: 'No',
        deprecated: false,
      },
    ],
  });
  assert.ok(!out.includes('Object.values(answers).some'));

  const moduleUrl = `data:text/javascript,${encodeURIComponent(
    out.replace(
      `../src/evaluators/configured-outcome.js`,
      new URL('../src/evaluators/configured-outcome.js', import.meta.url).href
    )
  )}`;
  const { default: compiledConfig } = await import(moduleUrl);

  assert.deepStrictEqual(
    compiledConfig.computeOutcome({
      'q-general-info': { value: 'No' },
    }),
    { verdict: 'pass', wording: 'Pass' }
  );
  assert.deepStrictEqual(
    compiledConfig.computeOutcome({
      'q-required-check': { value: 'No' },
    }),
    { verdict: 'fail', wording: 'Fail' }
  );
});

test('compileBank: omits category when absent', () => {
  const out = compileBank(
    bank({ id: 'q1', text: 'T', responseType: 'yes-no-na', deprecated: false })
  );
  assert.ok(!out.includes('category:'));
});

test('compileBank: includes category when present', () => {
  const out = compileBank(
    bank({
      id: 'q1',
      text: 'T',
      category: 'Opening',
      responseType: 'yes-no-na',
      deprecated: false,
    })
  );
  assert.ok(out.includes('category: "Opening"'));
});

test('compileBank: includes options when present', () => {
  const out = compileBank(
    bank({
      id: 'q1',
      text: 'T',
      responseType: 'single-choice',
      options: ['A', 'B'],
      deprecated: false,
    })
  );
  assert.ok(out.includes('options: ["A","B"]'));
});

test('compileBank: includes showWhen when present', () => {
  const out = compileBank(
    bank({
      id: 'q1',
      text: 'T',
      responseType: 'yes-no-na',
      showWhen: { q0: { equals: 'Yes' } },
      deprecated: false,
    })
  );
  assert.ok(out.includes('showWhen:'));
});

test('compileBank: includes failureCriteria when present', () => {
  const out = compileBank(
    bank({
      id: 'q1',
      text: 'T',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      deprecated: false,
    })
  );
  assert.ok(out.includes('failureCriteria: "No"'));
});

test('compileBank: emits remediationActions array when present', () => {
  const out = compileBank(
    bank({
      id: 'q1',
      text: 'T',
      responseType: 'yes-no-na',
      remediationActions: ['Action 1', 'Action 2'],
      deprecated: false,
    })
  );
  assert.ok(out.includes('remediationActions: ['));
  assert.ok(out.includes('"Action 1"'));
  assert.ok(out.includes('"Action 2"'));
});

test('compileBank: emits configured no-action and action outcome descriptors', () => {
  const out = compileBank(
    bank({
      id: 'q1',
      text: 'T',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      outcome: { noAction: { verdict: 'fail', wording: 'Fail', rank: 100 } },
      remediationActions: [
        {
          id: 'impact',
          text: 'Customer impact identified',
          outcome: { verdict: 'fail', wording: 'Fail with impact', rank: 120 },
        },
      ],
      deprecated: false,
    })
  );
  assert.ok(
    out.includes(
      'outcome: {"noAction":{"verdict":"fail","wording":"Fail","rank":100}}'
    )
  );
  assert.ok(out.includes('"id":"impact"'));
  assert.ok(out.includes('"wording":"Fail with impact"'));
});

test('compileBank: emits allowFreeFormRemediation when truthy', () => {
  const out = compileBank(
    bank({
      id: 'q1',
      text: 'T',
      responseType: 'yes-no-na',
      allowFreeFormRemediation: true,
      deprecated: false,
    })
  );
  assert.ok(out.includes('allowFreeFormRemediation: true'));
});

test('compileBank: emits deprecated: true', () => {
  const out = compileBank(
    bank({ id: 'q1', text: 'T', responseType: 'yes-no-na', deprecated: true })
  );
  assert.ok(out.includes('deprecated: true'));
});

test('compileBank: empty questions still produces a valid module', () => {
  const out = compileBank({
    label: 'L',
    slug: 's',
    eligibleGroups: [],
    questions: [],
  });
  assert.ok(out.includes('questions: ['));
  assert.ok(out.includes('export default config;'));
});

test('compileBank: preserves edited question order', () => {
  const out = compileBank({
    label: 'L',
    slug: 's',
    eligibleGroups: [],
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

  assert.ok(out.indexOf('id: "q-third"') < out.indexOf('id: "q-first"'));
});

test('compileBank: emits a labels block when the bank has labels', () => {
  const out = compileBank({
    label: 'L',
    slug: 's',
    eligibleGroups: [],
    labels: [
      { id: 'lbl-a', name: 'Alpha', color: '#123456' },
      { id: 'lbl-b', name: 'Beta', color: '#abcdef' },
    ],
    questions: [],
  });
  assert.ok(out.includes('labels: ['));
  assert.ok(out.includes('{ id: "lbl-a", name: "Alpha", color: "#123456" },'));
  assert.ok(out.includes('{ id: "lbl-b", name: "Beta", color: "#abcdef" },'));
});

test('compileBank: omits the labels block when there are none', () => {
  const out = compileBank({
    label: 'L',
    slug: 's',
    eligibleGroups: [],
    labels: [],
    questions: [],
  });
  assert.ok(!out.includes('labels: ['));
});

test('compileBank: emits labelIds on a question that carries them', () => {
  const out = compileBank(
    bank({
      id: 'q1',
      text: 'T',
      labelIds: ['lbl-a', 'lbl-b'],
      responseType: 'yes-no-na',
      deprecated: false,
    })
  );
  assert.ok(out.includes('labelIds: ["lbl-a","lbl-b"]'));
});

test('compileBank: omits labelIds when absent or empty', () => {
  const out = compileBank(
    bank({
      id: 'q1',
      text: 'T',
      labelIds: [],
      responseType: 'yes-no-na',
      deprecated: false,
    })
  );
  assert.ok(!out.includes('labelIds:'));
});

test('highlight: wraps comments, strings, keywords, booleans, and property keys', () => {
  const code = `const x = 'hi'; // comment\nreturn true;\nconst obj = { key: 1 };`;
  const out = highlight(code);
  assert.ok(out.includes('<span class="c">// comment</span>'));
  assert.ok(out.includes('<span class="k">const</span>'));
  assert.ok(out.includes('<span class="k">return</span>'));
  assert.ok(out.includes('<span class="b">true</span>'));
  assert.ok(out.includes('<span class="p">key</span>'));
  assert.ok(out.includes('<span class="s">&#39;hi&#39;</span>'));
});

test('highlight: handles double-quoted strings', () => {
  const out = highlight('const x = "hi";');
  assert.ok(out.includes('<span class="s">&quot;hi&quot;</span>'));
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
  eligibleGroups: ['Reviewers'],
  questions: [
    {
      id: 'q1',
      text: 'Was the agent polite?',
      category: 'Conduct',
      responseType: /** @type {const} */ ('yes-no-na'),
      failureCriteria: 'No',
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

test('compileExport: returns envelope with slug, label, generatedAt, hash, questions', async () => {
  const result = await compileExport(exportBank);
  assert.ok('slug' in result);
  assert.ok('label' in result);
  assert.ok('generatedAt' in result);
  assert.ok('hash' in result);
  assert.ok('questions' in result);
  assert.equal(result.slug, 'hello-review');
  assert.equal(result.label, 'Hello Review');
  assert.equal(result.questions.length, 2);
});

test('compileExport: preserves edited question order', async () => {
  const result = await compileExport({
    label: 'L',
    slug: 's',
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

test('compileExport: hash starts with sha256: followed by 64 hex chars (full digest)', async () => {
  const { hash } = await compileExport(exportBank);
  assert.match(hash, /^sha256:[0-9a-f]{64}$/);
});

test('compileExport: same questions+slug, different label/generatedAt → same hash', async () => {
  const bankA = { ...exportBank, label: 'Label A' };
  const bankB = { ...exportBank, label: 'Label B' };
  const [a, b] = await Promise.all([
    compileExport(bankA),
    compileExport(bankB),
  ]);
  assert.equal(a.hash, b.hash);
});

test('compileExport: different questions → different hash', async () => {
  const bankA = { ...exportBank };
  const bankB = {
    ...exportBank,
    questions: [
      { ...exportBank.questions[0], text: 'Different text' },
      exportBank.questions[1],
    ],
  };
  const [a, b] = await Promise.all([
    compileExport(bankA),
    compileExport(bankB),
  ]);
  assert.notEqual(a.hash, b.hash);
});

test('compileExport: different slug → different hash', async () => {
  const bankA = { ...exportBank, slug: 'slug-a' };
  const bankB = { ...exportBank, slug: 'slug-b' };
  const [a, b] = await Promise.all([
    compileExport(bankA),
    compileExport(bankB),
  ]);
  assert.notEqual(a.hash, b.hash);
});

test('compileExport: key order in question objects does not affect hash', async () => {
  const q = exportBank.questions[0];
  const qReordered = {
    text: q.text,
    deprecated: q.deprecated,
    id: q.id,
    failureCriteria: q.failureCriteria,
    category: q.category,
    responseType: q.responseType,
  };
  const bankA = { ...exportBank };
  const bankB = {
    ...exportBank,
    questions: [qReordered, exportBank.questions[1]],
  };
  const [a, b] = await Promise.all([
    compileExport(bankA),
    compileExport(bankB),
  ]);
  assert.equal(a.hash, b.hash);
});

test('compileExport: excludes computeOutcome, allowFreeFormRemediation, eligibleGroups', async () => {
  const bankWithExtras = {
    ...exportBank,
    questions: [
      {
        ...exportBank.questions[0],
        outcome: {
          noAction: {
            verdict: /** @type {const} */ ('fail'),
            wording: 'Fail',
            rank: 100,
          },
        },
        remediationActions: [
          {
            id: 'fix-it',
            text: 'Fix it',
            outcome: {
              verdict: /** @type {const} */ ('refer'),
              wording: 'Refer',
              rank: 50,
            },
          },
        ],
        allowFreeFormRemediation: true,
      },
      exportBank.questions[1],
    ],
  };
  const result = await compileExport(bankWithExtras);
  assert.ok(!('computeOutcome' in result));
  assert.ok(!('eligibleGroups' in result));
  for (const q of result.questions) {
    assert.ok(!('allowFreeFormRemediation' in q));
  }
  assert.deepEqual(result.questions[0].outcome, {
    noAction: { verdict: 'fail', wording: 'Fail', rank: 100 },
  });
  assert.deepEqual(result.questions[0].remediationActions, [
    {
      id: 'fix-it',
      text: 'Fix it',
      outcome: { verdict: 'refer', wording: 'Refer', rank: 50 },
    },
  ]);
});

test('compileExport: includes labelIds per question when present (ADR-0021 Step 5)', async () => {
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

test('compileExport: labelIds are omitted when absent or empty (ADR-0021 Step 5)', async () => {
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

test('compileExport: labelIds on questions affect the hash (ADR-0021 Step 5)', async () => {
  const bankA = { ...exportBank };
  const bankB = {
    ...exportBank,
    questions: [
      { ...exportBank.questions[0], labelIds: ['lbl-x'] },
      exportBank.questions[1],
    ],
  };
  const [a, b] = await Promise.all([
    compileExport(bankA),
    compileExport(bankB),
  ]);
  assert.notEqual(a.hash, b.hash);
});

test('compileExport: includes labels table in envelope (ADR-0021 Step 5)', async () => {
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

test('compileExport: labels table is empty array when bank has no labels (ADR-0021 Step 5)', async () => {
  const result = await compileExport(exportBank);
  assert.deepEqual(result.labels, []);
});

test('compileExport: absent optional question fields are emitted as null', async () => {
  const minimalBank = {
    label: 'L',
    slug: 's',
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
  assert.equal(q.showWhen, null);
  assert.equal(q.failureCriteria, null);
  assert.equal(q.outcome, null);
  assert.equal(q.remediationActions, null);
});

test('compileExport: present optional question fields are carried through', async () => {
  const result = await compileExport(exportBank);
  const q0 = result.questions[0];
  assert.equal(q0.category, 'Conduct');
  assert.equal(q0.failureCriteria, 'No');
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

test('compileExport: empty questions array produces deterministic hash', async () => {
  const emptyBank = {
    label: 'L',
    slug: 'empty',
    eligibleGroups: [],
    questions: [],
  };
  const [a, b] = await Promise.all([
    compileExport(emptyBank),
    compileExport(emptyBank),
  ]);
  assert.equal(a.hash, b.hash);
  assert.equal(a.questions.length, 0);
});

// ── buildPublishArtifacts ───────────────────────────────────────────────────

const pubEnvelope = {
  slug: 'test-review',
  label: 'Test Review',
  generatedAt: '2026-01-10T09:00:00.000Z',
  hash: 'sha256:' + 'a'.repeat(64),
  questions: [],
};

test('buildPublishArtifacts: first publish (null manifest) → isNew true', () => {
  const r = buildPublishArtifacts(pubEnvelope, null);
  assert.equal(r.isNew, true);
});

test('buildPublishArtifacts: first publish → versionedJson is the envelope as JSON', () => {
  const r = buildPublishArtifacts(pubEnvelope, null);
  assert.ok(r.versionedJson !== null);
  assert.deepEqual(JSON.parse(r.versionedJson), pubEnvelope);
});

test('buildPublishArtifacts: first publish → manifest has slug and one version entry', () => {
  const r = buildPublishArtifacts(pubEnvelope, null);
  assert.equal(r.manifest.slug, pubEnvelope.slug);
  assert.equal(r.manifest.versions.length, 1);
  assert.equal(r.manifest.versions[0].hash, pubEnvelope.hash);
  assert.equal(r.manifest.versions[0].generatedAt, pubEnvelope.generatedAt);
});

test('buildPublishArtifacts: null manifest treated same as empty-versions manifest', () => {
  const r1 = buildPublishArtifacts(pubEnvelope, null);
  const r2 = buildPublishArtifacts(pubEnvelope, {
    slug: pubEnvelope.slug,
    versions: [],
  });
  assert.equal(r1.manifest.versions.length, r2.manifest.versions.length);
  assert.equal(r1.isNew, r2.isNew);
});

test('buildPublishArtifacts: currentJson is always the envelope as pretty-printed JSON', () => {
  const r = buildPublishArtifacts(pubEnvelope, null);
  assert.equal(r.currentJson, JSON.stringify(pubEnvelope, null, 2));
});

test('buildPublishArtifacts: currentJson returned even on re-publish', () => {
  const existing = {
    slug: pubEnvelope.slug,
    versions: [
      { hash: pubEnvelope.hash, generatedAt: pubEnvelope.generatedAt },
    ],
  };
  const r = buildPublishArtifacts(pubEnvelope, existing);
  assert.equal(r.currentJson, JSON.stringify(pubEnvelope, null, 2));
});

test('buildPublishArtifacts: same hash again → isNew false', () => {
  const existing = {
    slug: pubEnvelope.slug,
    versions: [
      { hash: pubEnvelope.hash, generatedAt: pubEnvelope.generatedAt },
    ],
  };
  const r = buildPublishArtifacts(pubEnvelope, existing);
  assert.equal(r.isNew, false);
});

test('buildPublishArtifacts: same hash again → versionedJson null', () => {
  const existing = {
    slug: pubEnvelope.slug,
    versions: [
      { hash: pubEnvelope.hash, generatedAt: pubEnvelope.generatedAt },
    ],
  };
  const r = buildPublishArtifacts(pubEnvelope, existing);
  assert.equal(r.versionedJson, null);
});

test('buildPublishArtifacts: same hash again → manifest versions unchanged', () => {
  const existing = {
    slug: pubEnvelope.slug,
    versions: [
      { hash: pubEnvelope.hash, generatedAt: pubEnvelope.generatedAt },
    ],
  };
  const r = buildPublishArtifacts(pubEnvelope, existing);
  assert.equal(r.manifest.versions.length, 1);
});

test('buildPublishArtifacts: new distinct hash is appended to manifest', () => {
  const priorHash = 'sha256:' + 'b'.repeat(64);
  const existing = {
    slug: pubEnvelope.slug,
    versions: [{ hash: priorHash, generatedAt: '2026-01-01T00:00:00.000Z' }],
  };
  const r = buildPublishArtifacts(pubEnvelope, existing);
  assert.equal(r.isNew, true);
  assert.equal(r.manifest.versions.length, 2);
  assert.equal(r.manifest.versions[0].hash, priorHash);
  assert.equal(r.manifest.versions[1].hash, pubEnvelope.hash);
});

test('buildPublishArtifacts: preserves prior versions order and appends at end', () => {
  const v1 = {
    hash: 'sha256:' + 'b'.repeat(64),
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
  const v2 = {
    hash: 'sha256:' + 'c'.repeat(64),
    generatedAt: '2026-02-01T00:00:00.000Z',
  };
  const existing = { slug: pubEnvelope.slug, versions: [v1, v2] };
  const r = buildPublishArtifacts(pubEnvelope, existing);
  assert.equal(r.manifest.versions[0].hash, v1.hash);
  assert.equal(r.manifest.versions[1].hash, v2.hash);
  assert.equal(r.manifest.versions[2].hash, pubEnvelope.hash);
});

test('buildPublishArtifacts: does not mutate the existingManifest versions array', () => {
  const existing = { slug: pubEnvelope.slug, versions: [] };
  buildPublishArtifacts(pubEnvelope, existing);
  assert.equal(existing.versions.length, 0);
});

// ── buildPublishArtifacts: label table handling (ADR-0021 Step 5) ───────────

const pubEnvelopeWithLabels = {
  ...pubEnvelope,
  labels: [{ id: 'lbl-a', name: 'Alpha', color: '#ff0000' }],
};

test('buildPublishArtifacts: current JSON includes labels table (ADR-0021 Step 5)', () => {
  const r = buildPublishArtifacts(pubEnvelopeWithLabels, null);
  const current = JSON.parse(r.currentJson);
  assert.deepEqual(current.labels, [
    { id: 'lbl-a', name: 'Alpha', color: '#ff0000' },
  ]);
});

test('buildPublishArtifacts: versioned JSON omits labels table (ADR-0021 Step 5)', () => {
  const r = buildPublishArtifacts(pubEnvelopeWithLabels, null);
  assert.ok(r.versionedJson !== null);
  const versioned = JSON.parse(/** @type {string} */ (r.versionedJson));
  assert.ok(
    !('labels' in versioned),
    'versioned file must not carry the label table'
  );
});

test('buildPublishArtifacts: versioned JSON still carries all other envelope fields', () => {
  const r = buildPublishArtifacts(pubEnvelopeWithLabels, null);
  const versioned = JSON.parse(/** @type {string} */ (r.versionedJson));
  assert.equal(versioned.slug, pubEnvelopeWithLabels.slug);
  assert.equal(versioned.hash, pubEnvelopeWithLabels.hash);
  assert.equal(versioned.generatedAt, pubEnvelopeWithLabels.generatedAt);
  assert.deepEqual(versioned.questions, pubEnvelopeWithLabels.questions);
});

test('buildPublishArtifacts: envelope without labels produces identical versioned and current JSON', () => {
  const r = buildPublishArtifacts(pubEnvelope, null);
  assert.equal(r.versionedJson, r.currentJson);
});
