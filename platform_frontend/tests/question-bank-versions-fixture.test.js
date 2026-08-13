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

  const v1 = PUBLISHED_BANK_VERSIONS.find(
    (v) => v.hash === COMPLAINTS_BANK_V1_HASH
  );
  const v2 = PUBLISHED_BANK_VERSIONS.find(
    (v) => v.hash === COMPLAINTS_BANK_V2_HASH
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

test('the frozen versions are literal, so editing the live bank cannot move them', async () => {
  // A version resolved twice, either side of a bank compile, is the same
  // object graph. This is the property that makes them safe to stamp a Case
  // against; a derived "old" version would fail it the moment the bank moved.
  const first = await mockClient();
  const before = await first.getVersionedExport(
    'complaints',
    COMPLAINTS_BANK_V1_HASH
  );
  const second = await mockClient();
  const after = await second.getVersionedExport(
    'complaints',
    COMPLAINTS_BANK_V1_HASH
  );
  assert.deepEqual(before, after);
  assert.equal(before?.generatedAt, '2026-01-12T09:00:00.000Z');
});

test('the current version is compiled from the live bank and served under the stamping hash', async () => {
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
    'the current version is the live bank; it is compiled from it rather than hand-maintained'
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

test('a Case Type whose bank fails to compile loses only its current version', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    const { exportHashes, versionedExports } = await buildQuestionBankVersions({
      complaints: () => Promise.reject(new Error('bank artifact missing')),
    });
    assert.deepEqual(exportHashes, {});
    for (const version of PUBLISHED_BANK_VERSIONS) {
      assert.ok(
        versionedExports[version.hash],
        'the frozen versions stay served when a live bank cannot be compiled'
      );
    }
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1);
});
