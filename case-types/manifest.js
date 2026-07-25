// @ts-check
/**
 * @typedef {() => Promise<{ default: import('../src/sharepoint-client.js').CaseTypeConfig }>} CaseTypeImporter
 * @typedef {() => Promise<{ default: import('../src/pages/question-bank/question-bank-source.js').QuestionBank }>} QuestionBankImporter
 */

import { loadBank } from './load-bank.js';
import {
  OutcomeConfigurationError,
  validateConfiguredOutcomeConfig,
} from '../src/evaluators/configured-outcome.js';

/**
 * One Case Type's static identity plus the thunks that reach its lazily loaded
 * artifacts. `slug` and `displayName` are the only parts readable without
 * evaluating a Case Type module, which is what lets the boot-critical,
 * synchronous permissions config derive its per-Case-Type group names from this
 * one registry (#508) while keeping ADR-0004's lazy loading intact.
 *
 * `bank` is optional: a Case Type may be registered before its Question Bank
 * artifact exists (the scaffold path), in which case it simply does not appear
 * in the bank editor.
 *
 * @typedef {{
 * slug: string,
 * displayName: string,
 * importer: CaseTypeImporter,
 * bank?: QuestionBankImporter
 * }} CaseTypeEntry
 */

/**
 * THE Case Type registry. Adding a Case Type is one entry here, plus its config
 * module under `case-types/` and (optionally) its bank artifact under
 * `case-types/banks/`. `displayName` is load-bearing: it composes the three
 * provisioned SharePoint group names — see `caseTypeGroupNames()` in
 * `src/services/permissions.js`.
 *
 * @type {readonly CaseTypeEntry[]}
 */
export const CASE_TYPES = [
  {
    slug: 'complaints',
    displayName: 'Complaints',
    importer: () => import('./complaints.js'),
    bank: () => loadQuestionBank('./banks/complaints.txt'),
  },
];

/**
 * Derived from `CASE_TYPES` — the shape existing consumers already depend on.
 * @type {Record<string, CaseTypeImporter>}
 */
export const CASE_TYPE_IMPORTERS = Object.fromEntries(
  CASE_TYPES.map((caseType) => [caseType.slug, caseType.importer])
);

/**
 * Derived from `CASE_TYPES` — only the Case Types that declare a bank artifact.
 * @type {Record<string, QuestionBankImporter>}
 */
export const QUESTION_BANK_IMPORTERS = Object.fromEntries(
  CASE_TYPES.flatMap((caseType) =>
    caseType.bank ? [[caseType.slug, caseType.bank]] : []
  )
);

/**
 * @param {string} path
 * @returns {Promise<{ default: import('../src/pages/question-bank/question-bank-source.js').QuestionBank }>}
 */
async function loadQuestionBank(path) {
  return { default: await loadBank(path) };
}

export class UnknownCaseTypeError extends Error {
  /**
   * @param {string} slug
   * @param {string[]} knownSlugs
   */
  constructor(slug, knownSlugs) {
    super(
      `Unsupported Case Type slug "${slug}". Known Case Type slugs: ${knownSlugs.join(', ')}.`
    );
    this.name = 'UnknownCaseTypeError';
    this.slug = slug;
    this.knownSlugs = knownSlugs;
  }
}

export class InvalidCaseTypeConfigError extends Error {
  /**
   * @param {string} slug
   * @param {OutcomeConfigurationError} cause
   */
  constructor(slug, cause) {
    super(
      `Case Type "${slug}" has invalid outcome configuration: ${cause.message}`
    );
    this.name = 'InvalidCaseTypeConfigError';
    this.slug = slug;
  }
}

/**
 * @param {string} slug
 * @param {Record<string, CaseTypeImporter>} [importers]
 * @returns {Promise<import('../src/sharepoint-client.js').CaseTypeConfig>}
 */
export async function loadCaseTypeConfig(
  slug,
  importers = CASE_TYPE_IMPORTERS
) {
  const importer = importers[slug];
  if (!importer) {
    throw new UnknownCaseTypeError(
      slug,
      Object.keys(CASE_TYPE_IMPORTERS).sort()
    );
  }
  const mod = await importer();
  try {
    validateConfiguredOutcomeConfig(
      mod.default.questions,
      mod.default.outcomeOptions,
      mod.default.defaultOutcomeId
    );
  } catch (error) {
    if (error instanceof OutcomeConfigurationError) {
      throw new InvalidCaseTypeConfigError(slug, error);
    }
    throw error;
  }
  return mod.default;
}
