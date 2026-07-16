// @ts-check
/**
 * Question Bank source for the curator workbench.
 *
 * ADR-0021 treats the Question Bank as versionable content separate from the
 * operational Case Type config. The editor therefore reads the standalone bank
 * JSON text artifacts under case-types/banks/. Those files are hosted in
 * SharePoint and loaded asynchronously through the Case Type manifest; runtime
 * config fields stay in case-types/{slug}.js.
 */

import { QUESTION_BANK_IMPORTERS } from '../../../case-types/manifest.js';

/**
 * A reporting label that can be assigned to Question Definitions from the
 * question bank. Labels are bank-side metadata and do not affect Reviewer
 * presentation.
 *
 * @typedef {{ id: string, name: string, color: string }} Label
 */

/**
 * @typedef {import('../../sharepoint-client.js').OutcomeOption} OutcomeOption
 * @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition
 * @typedef {import('../../sharepoint-client.js').RemediationActionDefinition} RemediationActionDefinition
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
 *   eligibleGroups?: string[],
 *   labels?: Label[],
 *   outcomeOptions?: OutcomeOption[],
 *   defaultOutcomeId?: string,
 *   questions: DraftQuestion[],
 * }} QuestionBank
 */

/**
 * @param {QuestionBank} bank
 * @returns {QuestionBank}
 */
export function normaliseQuestionBank(bank) {
  return {
    label: bank.label,
    slug: bank.slug,
    labels: structuredClone(bank.labels ?? []),
    outcomeOptions: structuredClone(bank.outcomeOptions ?? []),
    defaultOutcomeId: bank.defaultOutcomeId,
    questions: structuredClone(bank.questions ?? []).map((question) => ({
      ...question,
      deprecated: question.deprecated ?? false,
    })),
  };
}

/**
 * @param {Record<string, () => Promise<{ default: QuestionBank }>>} [importers]
 * @returns {Promise<Record<string, QuestionBank>>}
 */
export async function loadQuestionBanks(importers = QUESTION_BANK_IMPORTERS) {
  const entries = await Promise.all(
    Object.entries(importers).map(async ([slug, importer]) => {
      const mod = await importer();
      return [slug, normaliseQuestionBank(mod.default)];
    })
  );
  return Object.fromEntries(entries);
}

/** @type {Record<string, QuestionBank>} */
export const questionBanks = await loadQuestionBanks();
