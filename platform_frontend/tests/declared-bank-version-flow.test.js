// @ts-check
/**
 * The declared-version contract, end to end: publish → open → answer →
 * complete → re-open, against real Question Bank artifact **files**.
 *
 * The version identifier here is `example1234` — deliberately nothing any
 * hash function could produce. That is the test's teeth: every step below can
 * only pass if the identity is *read* where it is declared (the bank's
 * `version` field, the versioned file's name) and carried verbatim onto the
 * Case row and back. If anything on the stamp or resolve path went back to
 * recomputing a digest, the stamp could not equal `example1234` and the
 * re-opened Case could not resolve its file.
 *
 * The artifacts live in a temporary `banks/` directory owned by this test,
 * not in `case-types/banks/`: everything in the deployed tree is scanned by
 * the repository gate and deployed byte-for-byte, so a fixture must not
 * appear there even briefly. The client below overrides only `_readArtifact`'s
 * directory; the filename composition (`bank-artifacts.js`), the text
 * read/parse (`load-bank.js`), the declaration read (`bank-version.js`), the
 * publish artifacts (`question-bank-compile.js`), the loader's freeze and the
 * completion stamp are all the real code paths.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createInMemoryFlowRunner } from './_in-memory-flow-runner.js';
import { makeCaseRow } from './helpers/fixtures.js';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';
import { registerCaseType } from '../case-types/manifest.js';
import { loadBank } from '../case-types/load-bank.js';
import {
  bankArtifactName,
  versionedExportName,
} from '../src/lib/bank-artifacts.js';
import {
  buildPublishArtifacts,
  compileExport,
} from '../src/pages/question-bank/question-bank-compile.js';
import { computeConfiguredOutcome } from '../src/evaluators/configured-outcome.js';

const SLUG = 'single-question-review';
const LIST = 'Cases-SingleQuestionReview';
const AS_REVIEWED_TEXT = 'Was the single question handled correctly?';

// ── the temporary bank: one question, hand-declared version `example1234` ──

const banksDir = await mkdtemp(join(tmpdir(), 'cora-banks-'));
after(() => rm(banksDir, { recursive: true, force: true }));

/** @param {string} filename */
const artifactPath = (filename) => join(banksDir, filename);

/**
 * Publish one version of the bank into the temp directory exactly as a hand
 * publisher (or `scripts/publish-bank.js`) would: declare the identifier on
 * the bank, then write the bank and the immutable copy its declaration names.
 *
 * @param {string} version
 * @param {string} questionText
 * @param {Array<{ version: string, generatedAt: string }>} [history]
 */
async function publishTempBank(version, questionText, history = []) {
  const bank = /** @type {any} */ ({
    slug: SLUG,
    label: 'Single Question Review',
    version,
    history,
    questions: [
      {
        id: 'q-only',
        text: questionText,
        responseType: 'yes-no-na',
        optionOutcomes: { No: 'fail' },
        deprecated: false,
      },
    ],
    outcomeOptions: [
      { id: 'pass', wording: 'Pass', severity: 0 },
      { id: 'fail', wording: 'Fail', severity: 100 },
    ],
    defaultOutcomeId: 'pass',
  });
  const artifacts = buildPublishArtifacts(await compileExport(bank), bank);
  assert.ok(artifacts.versionedJson, `version ${version} is new`);
  await writeFile(artifactPath(bankArtifactName(SLUG)), artifacts.bankJson);
  await writeFile(
    artifactPath(versionedExportName(SLUG, version)),
    artifacts.versionedJson + '\n'
  );
}

await publishTempBank('example1234', AS_REVIEWED_TEXT);

// ── a Case Type whose config exposes that bank, registered for this process ──

const bankAtRegistration = await loadBank(
  pathToFileURL(artifactPath(bankArtifactName(SLUG)))
);

/** @type {import('../src/sharepoint-client.js').CaseTypeConfig} */
const config = {
  listName: LIST,
  sections: {
    details: {},
    questions: { showInSummary: true },
    summary: {},
  },
  outcomeOptions: bankAtRegistration.outcomeOptions ?? [],
  defaultOutcomeId: bankAtRegistration.defaultOutcomeId ?? '',
  questions: bankAtRegistration.questions,
  computeOutcome(answers) {
    return computeConfiguredOutcome(
      config.questions,
      answers,
      config.outcomeOptions,
      config.defaultOutcomeId
    );
  },
};

registerCaseType({
  slug: SLUG,
  displayName: 'Single Question Review',
  importer: async () => ({ default: config }),
});

// ── the client: the real mock, reading bank artifacts from the temp dir ──

class TempBanksClient extends MockSharePointClient {
  /** @param {string} filename */
  _readArtifact(filename) {
    return loadBank(pathToFileURL(artifactPath(filename)));
  }
}

function makeRunner() {
  return createInMemoryFlowRunner(
    {},
    {
      client: new TempBanksClient({
        personas: {
          reviewer: {
            userId: 'user-reviewer',
            displayName: 'Reviewer',
            groups: ['Reviewers'],
          },
        },
        persona: 'reviewer',
        lists: {
          [LIST]: [
            makeCaseRow({
              id: 'sq-case-1',
              caseType: SLUG,
              title: 'Single question case',
              responsibleParty: 'user-agent-a',
              etag: 'etag-sq-1',
            }),
          ],
        },
      }),
    }
  );
}

// Tests in one file run in order, and each leans on the state the previous one
// left behind — the point being tested *is* the round trip.
const runner = makeRunner();

test('opening the Case loads the single question from the temporary bank', async () => {
  await runner.run([
    { type: 'loadCasePage', caseId: 'sq-case-1', caseType: SLUG },
  ]);

  const loader = runner.caseLoader;
  assert.ok(loader);
  assert.deepEqual(
    loader.catalogue.map((q) => q.id),
    ['q-only']
  );
  assert.equal(loader.catalogue[0].text, AS_REVIEWED_TEXT);
  // What completion will stamp: the bank file's declaration, read verbatim.
  // `example1234` is not a digest of anything, so a recomputation anywhere on
  // this path could not produce it.
  assert.equal(loader.bankVersion, 'example1234');
  assert.equal(loader.versionWarning, null);
});

test('answering the one question and completing stamps the declared version', async () => {
  const snapshot = await runner.run([
    { type: 'answer', questionId: 'q-only', value: 'Yes' },
    { type: 'clickCompleteCase' },
  ]);

  const row = snapshot.lists[LIST].find((c) => c.id === 'sq-case-1');
  assert.ok(row);
  assert.equal(row.status, 'Completed');
  assert.equal(row.answers['q-only'].value, 'Yes');
  assert.equal(row.outcomeAtCompletion, 'pass');
  assert.equal(row.questionBankVersion, 'example1234');
});

test('re-opening the completed Case still loads the single question', async () => {
  await runner.run([
    { type: 'loadCasePage', caseId: 'sq-case-1', caseType: SLUG },
  ]);

  const loader = runner.caseLoader;
  assert.ok(loader);
  assert.deepEqual(
    loader.catalogue.map((q) => q.id),
    ['q-only']
  );
  // No fallback banner: the stamped version resolved to a published file.
  assert.equal(loader.versionWarning, null);
});

test('the frozen catalogue comes from the example1234 file, not the live bank', async () => {
  // Publish a new version of the bank with the question reworded — the state
  // the freeze exists for. The current bank now declares `example5678`; the
  // completed Case's stamp still says `example1234`.
  const reworded = 'Was the single question handled correctly? (reworded)';
  const bank = JSON.parse(
    await readFile(artifactPath(bankArtifactName(SLUG)), 'utf8')
  );
  await publishTempBank('example5678', reworded, bank.history);

  await runner.run([
    { type: 'loadCasePage', caseId: 'sq-case-1', caseType: SLUG },
  ]);

  const loader = runner.caseLoader;
  assert.ok(loader);
  // The current declaration moved on…
  assert.equal(loader.bankVersion, 'example5678');
  // …but the Case renders the as-reviewed wording, which now exists nowhere
  // except `single-question-review.example1234.txt` — so that file is where
  // the catalogue came from.
  assert.equal(loader.versionWarning, null);
  assert.equal(loader.catalogue[0].text, AS_REVIEWED_TEXT);
  assert.notEqual(loader.catalogue[0].text, reworded);

  const versionedFile = JSON.parse(
    await readFile(
      artifactPath(versionedExportName(SLUG, 'example1234')),
      'utf8'
    )
  );
  assert.equal(versionedFile.questions[0].text, loader.catalogue[0].text);
});
