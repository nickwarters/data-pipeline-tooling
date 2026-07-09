// @ts-check
/**
 * Synchronous Question Bank source for the curator workbench.
 *
 * The editor should reflect the live Case Type configs, not a parallel fixture
 * bank. These projections keep the workbench's editable shape while taking the
 * actual question definitions and Case Type metadata from case-types/.
 */

import exampleReview from '../../case-types/example-review.js';
import complaints from '../../case-types/complaints.js';
import productSaleReview from '../../case-types/product-sale-review.js';
import stressReview from '../../case-types/stress-review.js';

/**
 * A reporting label that can be assigned to Question Definitions from the
 * question bank. Labels are bank-side metadata and do not affect Reviewer
 * presentation.
 *
 * @typedef {{ id: string, name: string, color: string }} Label
 */

/**
 * @typedef {import('../sharepoint-client.js').OutcomeOption} OutcomeOption
 * @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition
 * @typedef {import('../sharepoint-client.js').RemediationActionDefinition} RemediationActionDefinition
 */

/**
 * @typedef {{
 *   id: string,
 *   text: string,
 *   category?: string,
 *   labelIds?: string[],
 *   responseType: 'yes-no-na' | 'single-choice' | 'multi-choice' | 'outcome',
 *   options?: string[],
 *   optionOutcomes?: Record<string, string>,
 *   showWhen?: Record<string, unknown>,
 *   failureCriteria?: string,
 *   remediationActions?: Array<string | RemediationActionDefinition>,
 *   allowFreeFormRemediation?: boolean,
 *   deprecated: boolean,
 * }} DraftQuestion
 */

/**
 * @typedef {{
 *   label: string,
 *   slug: string,
 *   eligibleGroups: string[],
 *   labels?: Label[],
 *   outcomeOptions?: OutcomeOption[],
 *   defaultOutcomeId?: string,
 *   questions: DraftQuestion[],
 * }} QuestionBank
 */

/**
 * @param {string} slug
 * @param {import('../sharepoint-client.js').CaseTypeConfig} config
 * @returns {QuestionBank}
 */
export function bankFromCaseTypeConfig(slug, config) {
  return {
    label: labelFromSlug(slug),
    slug,
    eligibleGroups: [...(config.eligibleGroups ?? [])],
    labels: structuredClone(config.labels ?? []),
    outcomeOptions: structuredClone(config.outcomeOptions ?? []),
    defaultOutcomeId: config.defaultOutcomeId,
    questions: structuredClone(config.questions ?? []).map((question) => ({
      ...question,
      deprecated: question.deprecated ?? false,
    })),
  };
}

/** @type {Record<string, QuestionBank>} */
export const questionBanks = {
  'example-review': bankFromCaseTypeConfig('example-review', exampleReview),
  complaints: bankFromCaseTypeConfig('complaints', complaints),
  'product-sale-review': bankFromCaseTypeConfig(
    'product-sale-review',
    productSaleReview
  ),
  'stress-review': bankFromCaseTypeConfig('stress-review', stressReview),
};

/**
 * @param {string} slug
 * @returns {string}
 */
function labelFromSlug(slug) {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
