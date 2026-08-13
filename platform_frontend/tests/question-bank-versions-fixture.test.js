// @ts-check
/**
 * The mock's published Question Bank versions.
 *
 * `CaseLoader`'s freeze behaviour is covered in case-loader.test.js; what is
 * covered here is the dev-loop wiring underneath it, which fails silently. A
 * fixture Case stamped with a hash nothing serves does not break — it falls
 * back to the live bank behind a small warning banner, looking almost exactly
 * like the frozen Case it is supposed to be. Every assertion below exists
 * because that degradation is invisible.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { cases } from '../dev/fixtures/cases.js';
import {
  PUBLISHED_BANK_VERSIONS,
  RETIRED_QUESTION_ID,
  COMPLAINTS_BANK_V1_HASH,
  COMPLAINTS_BANK_V2_HASH,
  buildQuestionBankVersions,
} from '../dev/fixtures/question-bank-versions.js';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';
import { allApplicableAnswered } from '../src/evaluators/applicability-evaluator.js';
import { personas } from '../dev/fixtures/personas.js';
import { QUESTION_BANK_IMPORTERS } from '../case-types/manifest.js';
import {
  currentExportName,
  versionedExportName,
} from '../src/lib/bank-artifacts.js';
import { compileExport } from '../src/pages/question-bank/question-bank-compile.js';
import { CaseLoader } from '../src/lib/case-loader.js';
import complaintsConfig from '../case-types/complaints.js';
import { caps } from './helpers/section-access.js';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';

isolateBrowserGlobals();

/** @returns {Promise<MockSharePointClient>} */
async function mockClient() {
  const { exportHashes, versionedExports } = await buildQuestionBankVersions();
  return new MockSharePointClient({
    personas,
    exportHashes,
    versionedExports,
    lists: { [/** @type {string} */ (complaintsConfig.listName)]: cases },
  });
}

const stampedCases = cases.filter((c) => c.questionBankVersion);

test('every stamped fixture Case resolves to a version the mock serves', async () => {
  const client = await mockClient();

  assert.ok(
    stampedCases.length >= 2,
    'the fixture set must carry Cases frozen against an older Question Bank version'
  );
  for (const row of stampedCases) {
    const version = await client.getVersionedExport(
      row.caseType,
      /** @type {string} */ (row.questionBankVersion)
    );
    assert.ok(
      version,
      `Case ${row.id} stamps ${row.questionBankVersion}, which no published version matches — it would silently fall back to the live bank`
    );
    assert.equal(version.hash, row.questionBankVersion);
  }
});

test('the two stamped Cases are frozen at different versions', () => {
  const stamps = new Set(stampedCases.map((c) => c.questionBankVersion));
  assert.deepEqual(
    [...stamps].sort(),
    [COMPLAINTS_BANK_V1_HASH, COMPLAINTS_BANK_V2_HASH].sort()
  );
});

test('a stamped Case only answers questions its own version asks', async () => {
  const client = await mockClient();

  for (const row of stampedCases) {
    const version =
      /** @type {import('../src/sharepoint-client.js').VersionedExport} */ (
        await client.getVersionedExport(
          row.caseType,
          /** @type {string} */ (row.questionBankVersion)
        )
      );
    const asked = new Set(version.questions.map((q) => q.id));
    for (const answered of Object.keys(row.answers)) {
      assert.ok(
        asked.has(answered),
        `Case ${row.id} answers ${answered}, which its as-reviewed version does not ask`
      );
    }
  }
});

test('a stamped Case answers every Question its own version makes applicable', async () => {
  // The live-bank Cases are held to this in complaints.test.js. A frozen Case
  // is held to it here instead, against the catalogue it actually resolves —
  // otherwise the fixtures would only have to look complete against a bank
  // neither Case was reviewed with.
  const client = await mockClient();

  for (const row of stampedCases) {
    const version =
      /** @type {import('../src/sharepoint-client.js').VersionedExport} */ (
        await client.getVersionedExport(
          row.caseType,
          /** @type {string} */ (row.questionBankVersion)
        )
      );
    const catalogue = /** @type {any[]} */ (
      version.questions.filter((q) => !q.deprecated)
    );
    assert.equal(
      allApplicableAnswered(catalogue, row.answers),
      true,
      `${row.id} answers every Question its as-reviewed version applies`
    );
  }
});

test('the January version asks a question no later version and no live bank does', async () => {
  const { default: liveBank } = await QUESTION_BANK_IMPORTERS.complaints();
  const liveIds = new Set(liveBank.questions.map((q) => q.id));
  assert.equal(
    liveIds.has(RETIRED_QUESTION_ID),
    false,
    'the retired question must be absent from the live bank, or the frozen Case demonstrates nothing'
  );

  const client = await mockClient();
  const v1 = await client.getVersionedExport(
    'complaints',
    COMPLAINTS_BANK_V1_HASH
  );
  const v2 = await client.getVersionedExport(
    'complaints',
    COMPLAINTS_BANK_V2_HASH
  );
  assert.ok(v1 && v2);
  assert.ok(v1.questions.some((q) => q.id === RETIRED_QUESTION_ID));
  assert.equal(
    v2.questions.some((q) => q.id === RETIRED_QUESTION_ID),
    false
  );

  const frozen = cases.find((c) => c.id === 'complaints-frozen-v1');
  assert.ok(frozen);
  assert.ok(
    RETIRED_QUESTION_ID in frozen.answers,
    'the Case frozen at the January version must answer the retired question'
  );
});

test('a published version is a file, named by the hash inside it', async () => {
  // The app finds a version by composing its filename from the hash on the Case
  // row. If a file's name and its own `hash` disagreed, the app would serve
  // content under an identity that never produced it — so the two are checked
  // against the bytes on disk, not against the loader that read them.
  for (const { slug, hash } of PUBLISHED_BANK_VERSIONS) {
    const file = new URL(
      `../case-types/banks/${versionedExportName(slug, hash)}`,
      import.meta.url
    );
    const envelope = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(envelope.hash, hash, `${versionedExportName(slug, hash)}`);
    assert.equal(envelope.slug, slug);
    assert.ok(envelope.generatedAt, 'a version records when it was published');
  }
});

test('the published versions are immutable, so editing the live bank cannot move them', async () => {
  // The property that makes a version safe to stamp a Case against. The live
  // bank is compiled here and must produce a hash that is none of the published
  // older versions: if editing the bank could land on one of their hashes, it
  // would rewrite what an already-completed Case shows.
  const { default: liveBank } = await QUESTION_BANK_IMPORTERS.complaints();
  const compiled = await compileExport(liveBank);
  for (const { hash } of PUBLISHED_BANK_VERSIONS) {
    assert.notEqual(compiled.hash, hash);
  }
});

test('the current export is in step with the bank beside it', async () => {
  // `{slug}.export.txt` is what completion stamps and what a Case then resolves
  // against. If the bank is edited without republishing, a Case completed today
  // freezes against content that is not what the Reviewer was shown — so the
  // published pointer has to be regenerated whenever the bank changes.
  const { default: liveBank } = await QUESTION_BANK_IMPORTERS.complaints();
  const compiled = await compileExport(liveBank);
  const published = JSON.parse(
    readFileSync(
      new URL(
        `../case-types/banks/${currentExportName('complaints')}`,
        import.meta.url
      ),
      'utf8'
    )
  );
  assert.equal(
    published.hash,
    compiled.hash,
    'the bank has changed since it was last published — run `node scripts/publish-bank.js`'
  );
});

test('the current published version is served under the hash completion stamps', async () => {
  const client = await mockClient();

  // What completion stamps onto a Case row it completes today.
  const hash = await client.getExportHash('complaints');
  assert.ok(
    hash?.startsWith('sha256:'),
    'the mock must offer a current version hash, or a Case completed in the dev loop stamps nothing'
  );

  const current = await client.getVersionedExport(
    'complaints',
    /** @type {string} */ (hash)
  );
  assert.ok(
    current,
    'the hash completion stamps must resolve, or every newly completed Case shows the fallback warning'
  );

  const { default: liveBank } = await QUESTION_BANK_IMPORTERS.complaints();
  assert.deepEqual(
    current.questions.map((q) => q.id),
    liveBank.questions.map((q) => q.id),
    'the current published version is the current bank'
  );
  assert.notEqual(hash, COMPLAINTS_BANK_V1_HASH);
  assert.notEqual(hash, COMPLAINTS_BANK_V2_HASH);
});

test('opening the frozen Case in the dev loop renders the bank it was reviewed with', async () => {
  // The whole point of the fixture, asserted through the real path: the mock
  // client, the real CaseLoader, and the Case row as the dev loop serves it.
  const client = await mockClient();
  const loader = new CaseLoader({
    client: /** @type {any} */ (client),
    saveQueue: /** @type {any} */ ({ loadCase() {}, enqueue() {} }),
    caseId: 'complaints-frozen-v1',
    currentUserId: 'user-reviewer',
    capabilities: caps({ isReviewer: true }),
    caseType: 'complaints',
  });

  await loader.load();
  const snapshot = loader.toStoreSnapshot();

  assert.equal(snapshot.error, null);
  assert.equal(
    snapshot.versionWarning,
    null,
    'a stamped version the mock serves resolves outright — no fallback banner'
  );

  const shown = snapshot.catalogue.map((q) => q.id);
  assert.deepEqual(shown, ['q-cmp-0001', RETIRED_QUESTION_ID, 'q-cmp-0016']);
  assert.equal(
    shown.length < complaintsConfig.questions.length,
    true,
    'the frozen Case must not pick up the questions added since it was reviewed'
  );

  const asked = snapshot.catalogue.find((q) => q.id === 'q-cmp-0001');
  assert.equal(
    asked?.text,
    'Was the complaint logged on the register on the day of receipt?',
    'the wording is the as-reviewed one, not the live bank rewrite'
  );
});

test('an unreadable artifact costs its own version and nothing else', async () => {
  // A published version file that is missing is a real deploy state, and it is
  // the state the loader's fallback exists for. It must not take the other
  // versions — or the current one — down with it.
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  let result;
  try {
    result = await buildQuestionBankVersions([
      ...PUBLISHED_BANK_VERSIONS,
      { slug: 'complaints', hash: `sha256:${'f'.repeat(64)}` },
    ]);
  } finally {
    console.error = original;
  }

  assert.equal(errors.length, 1, 'the missing version is reported once');
  assert.equal(result.versionedExports[`sha256:${'f'.repeat(64)}`], undefined);
  for (const { hash } of PUBLISHED_BANK_VERSIONS) {
    assert.ok(result.versionedExports[hash], 'every readable version survives');
  }
  assert.ok(result.exportHashes.complaints, 'the current version survives too');
});

test('a Case Type with no published export simply stamps nothing', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  let result;
  try {
    result = await buildQuestionBankVersions(PUBLISHED_BANK_VERSIONS, [
      { slug: 'never-published' },
    ]);
  } finally {
    console.error = original;
  }

  assert.deepEqual(result.exportHashes, {});
  for (const { hash } of PUBLISHED_BANK_VERSIONS) {
    assert.ok(result.versionedExports[hash]);
  }
  assert.equal(errors.length, 1);
});
