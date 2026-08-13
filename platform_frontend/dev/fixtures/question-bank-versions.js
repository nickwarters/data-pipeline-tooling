// @ts-check
/**
 * The published Question Bank versions the mock client serves (`?mock=1`).
 *
 * A Case freezes its Question Bank at the reportable milestone: the row stores
 * the version hash then current, and re-opening the Case resolves its questions
 * from that immutable versioned export rather than from today's bank. Without a
 * shelf of published versions the dev loop can only ever show a Case against
 * the live bank, so the freeze — the whole point of stamping a version — is
 * invisible until UAT.
 *
 * Two kinds of version live here, and they are built differently on purpose:
 *
 * - The **older versions** are literal, hand-written exports with literal
 *   hashes. A frozen version has to be genuinely frozen: if these were derived
 *   from the live bank they would move every time someone edits a question, and
 *   a fixture Case stamped against one would show today's content while
 *   claiming to show January's.
 * - The **current version** is compiled from the live bank artifact, because
 *   that is what "current" means — the newest published version and the bank on
 *   screen are the same content by definition. Compiling it also gives the mock
 *   a real hash for `getExportHash()`, so completing a Case in the dev loop
 *   stamps a version that resolves instead of falling back with a warning.
 *
 * The hashes below are opaque labels, exactly as a reader is required to treat
 * them: only the compile step authors a hash, and nothing here or in the app
 * recomputes one.
 */

/** @typedef {import('../../src/sharepoint-client.js').VersionedExport} VersionedExport */

import { QUESTION_BANK_IMPORTERS } from '../../case-types/manifest.js';
// The compile drawer is the publish flow; this fixture stands in for a publish
// that has already happened, so it compiles the current bank the same way.
import { compileExport } from '../../src/pages/question-bank/question-bank-compile.js';

/** The version in force in January — before the courtesy-call check was retired. */
export const COMPLAINTS_BANK_V1_HASH = `sha256:${'b1'.repeat(32)}`;

/** The version in force in April — the courtesy-call check gone, the logging question reworded. */
export const COMPLAINTS_BANK_V2_HASH = `sha256:${'c2'.repeat(32)}`;

const OUTCOME_OPTIONS = [
  { id: 'good', wording: 'Good', severity: 0 },
  {
    id: 'good-with-process-enhancement',
    wording: 'Good with process enhancement',
    severity: 25,
  },
  { id: 'poor', wording: 'Poor', severity: 50 },
  { id: 'poor-with-harm', wording: 'Poor with harm', severity: 100 },
];

const OUTCOME_RESPONSES = OUTCOME_OPTIONS.map((o) => o.wording);

const OPTION_OUTCOMES = Object.fromEntries(
  OUTCOME_OPTIONS.map((o) => [o.wording, o.id])
);

/**
 * One outcome-scored Question Definition in the shape a versioned export
 * carries — every key present, including the nulls, because an export is
 * data-only and readers do not fill blanks in.
 *
 * @param {string} id
 * @param {string} text
 * @param {string} questionGroup
 * @param {string[]} [remediationActions]
 * @returns {VersionedExport['questions'][number]}
 */
function frozenQuestion(id, text, questionGroup, remediationActions = []) {
  return {
    id,
    text,
    category: null,
    questionGroup,
    responseType: 'outcome',
    options: OUTCOME_RESPONSES,
    optionOutcomes: OPTION_OUTCOMES,
    showWhen: null,
    remediationActions: remediationActions.map((action, index) => ({
      id: `${id}-ra-${index}`,
      text: action,
    })),
    deprecated: false,
  };
}

/**
 * The Question Definition retired between v1 and v2. Its id appears in no
 * later version and in no live bank, so a Case frozen at v1 is the only place
 * it can still be read — which is the behaviour worth being able to demo.
 */
export const RETIRED_QUESTION_ID = 'q-cmp-0900';

/** @type {VersionedExport} */
const COMPLAINTS_BANK_V1 = {
  slug: 'complaints',
  label: 'Complaints',
  generatedAt: '2026-01-12T09:00:00.000Z',
  hash: COMPLAINTS_BANK_V1_HASH,
  questions: [
    frozenQuestion(
      'q-cmp-0001',
      'Was the complaint logged on the register on the day of receipt?',
      'Acknowledgement',
      ['Log the complaint on the register and correct the recorded date.']
    ),
    frozenQuestion(
      RETIRED_QUESTION_ID,
      'Was a courtesy call offered to the customer within 24 hours of receipt?',
      'Acknowledgement'
    ),
    frozenQuestion(
      'q-cmp-0016',
      'Was the redress calculation checked against the redress methodology?',
      'Resolution',
      ['Recalculate the redress and offer it to the customer.']
    ),
  ],
  outcomeOptions: OUTCOME_OPTIONS,
  defaultOutcomeId: 'good',
};

/** @type {VersionedExport} */
const COMPLAINTS_BANK_V2 = {
  slug: 'complaints',
  label: 'Complaints',
  generatedAt: '2026-04-03T14:30:00.000Z',
  hash: COMPLAINTS_BANK_V2_HASH,
  questions: [
    frozenQuestion(
      'q-cmp-0001',
      'Was the complaint logged on the complaints register on the day it was received?',
      'Acknowledgement',
      [
        'Log the complaint on the complaints register and correct the recorded receipt date.',
      ]
    ),
    frozenQuestion(
      'q-cmp-0016',
      'Was the redress calculation checked against the redress methodology?',
      'Resolution',
      ['Recalculate the redress against the current methodology.']
    ),
  ],
  outcomeOptions: OUTCOME_OPTIONS,
  defaultOutcomeId: 'good',
};

/**
 * The frozen older versions, oldest first — the mock's stand-in for the
 * append-only `{slug}.{hash}.json` files a real publish writes. The current
 * version is not here; it is compiled from the live bank in
 * `buildQuestionBankVersions()`.
 *
 * @type {VersionedExport[]}
 */
export const PUBLISHED_BANK_VERSIONS = [COMPLAINTS_BANK_V1, COMPLAINTS_BANK_V2];

/**
 * Builds the mock client's version shelf: every frozen older version above,
 * plus the current version compiled from each registered Case Type's live bank
 * artifact.
 *
 * Contained per Case Type, as the mock's Case partitioning is: a bank that
 * fails to load or compile costs that Case Type its *current* version only —
 * a Case completed in the dev loop then falls back to the live bank with the
 * standard warning, and every frozen version stays served.
 *
 * @param {Record<string, () => Promise<{ default: import('../../src/pages/question-bank/question-bank-source.js').QuestionBank }>>} [bankImporters]
 * @returns {Promise<{ exportHashes: Record<string, string>, versionedExports: Record<string, VersionedExport> }>}
 */
export async function buildQuestionBankVersions(
  bankImporters = QUESTION_BANK_IMPORTERS
) {
  /** @type {Record<string, VersionedExport>} */
  const versionedExports = {};
  for (const version of PUBLISHED_BANK_VERSIONS) {
    versionedExports[version.hash] = version;
  }

  /** @type {Record<string, string>} */
  const exportHashes = {};
  for (const [slug, importBank] of Object.entries(bankImporters)) {
    try {
      const { default: bank } = await importBank();
      const current = await compileExport(bank);
      versionedExports[current.hash] = current;
      exportHashes[slug] = current.hash;
    } catch (error) {
      console.error(
        `[CORA] Question Bank for "${slug}" could not be compiled; the mock serves no current version for it:`,
        error
      );
    }
  }

  return { exportHashes, versionedExports };
}
