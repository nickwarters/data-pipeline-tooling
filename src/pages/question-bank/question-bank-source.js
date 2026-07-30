// @ts-check
/**
 * Question Bank source for the curator workbench.
 *
 * The Question Bank is versionable content, separate from the operational Case
 * Type config. The editor therefore reads the standalone bank
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
 *   questionGroup?: string,
 *   labelIds?: string[],
 *   responseType: 'yes-no-na' | 'single-choice' | 'multi-choice' | 'outcome',
 *   options?: string[],
 *   optionOutcomes?: Record<string, string>,
 *   showWhen?: Record<string, unknown>,
 *   remediationActions?: Array<string | RemediationActionDefinition>,
 *   disallowFreeFormRemediation?: boolean,
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
 * @typedef {{ slug: string, message: string }} BankLoadFailure
 * @typedef {{ banks: Record<string, QuestionBank>, failures: BankLoadFailure[] }} LoadedQuestionBanks
 */

/**
 * Load every Question Bank artifact, per bank. One unreachable or malformed
 * artifact costs the editor that bank alone: the rest still load and the
 * failure is reported by slug so the editor can name it.
 *
 * This function performs I/O and is therefore never called at module scope —
 * the bank editor route slice calls it from `start()`.
 *
 * `only` narrows the load to the named slugs, which is what a retry needs:
 * re-running every importer to recover one artifact would re-fetch banks that
 * were fine and that a curator may already be editing. A named slug with no
 * importer is deliberately NOT filtered out — it lands in `failures`, because a
 * retry that silently dropped the slug it was asked about would clear the
 * failure banner while nothing had been recovered. It fails with a message
 * written for the curator who reads it in the banner.
 *
 * @param {Record<string, () => Promise<{ default: QuestionBank }>>} [importers]
 * @param {string[]} [only] slugs to load; every registered slug by default
 * @returns {Promise<LoadedQuestionBanks>}
 */
export async function loadQuestionBanks(
  importers = QUESTION_BANK_IMPORTERS,
  only
) {
  const slugs = only ?? Object.keys(importers);
  const settled = await Promise.allSettled(
    slugs.map(async (slug) => {
      const importer = importers[slug];
      if (typeof importer !== 'function') {
        throw new Error(`No Question Bank importer registered for "${slug}"`);
      }
      return normaliseQuestionBank((await importer()).default);
    })
  );
  /** @type {Record<string, QuestionBank>} */
  const banks = {};
  /** @type {BankLoadFailure[]} */
  const failures = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') banks[slugs[index]] = result.value;
    else
      failures.push({
        slug: slugs[index],
        message:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
  });
  return { banks, failures };
}
