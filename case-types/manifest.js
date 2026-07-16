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
 * @type {Record<string, CaseTypeImporter>}
 */
export const CASE_TYPE_IMPORTERS = {
  complaints: () => import('./complaints.js'),
};

/**
 * @type {Record<string, QuestionBankImporter>}
 */
export const QUESTION_BANK_IMPORTERS = {
  complaints: () => loadQuestionBank('./banks/complaints.txt'),
};

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
