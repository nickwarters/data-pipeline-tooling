// @ts-check
/**
 * A Question Bank's version identity, and the export projection it is computed
 * over.
 *
 * A version identity is just an **identifier** — a way to say "this bank" and
 * "that other bank" and to name a file. It happens to be a hash of the
 * published questions, which is convenient (it changes when the content does,
 * and it is unique), but nothing depends on how it is produced. Only one thing
 * computes one, and everything else treats it as an opaque string.
 *
 * It is **derived, not stored beside the bank**. There is no current-version
 * pointer file: `case-types/banks/{slug}.txt` is the current version. A pointer
 * would be a second copy of the same fact, and a bank edited without
 * republishing would go on claiming the old version.
 *
 * This lives in `lib/` rather than with the Question Bank editor because the
 * SharePoint clients ask what the current version is on the path that stamps a
 * Case.
 */

/** @typedef {import('../pages/question-bank/question-bank-source.js').QuestionBank} QuestionBank */
/** @typedef {import('../pages/question-bank/question-bank-source.js').DraftQuestion} DraftQuestion */
/** @typedef {import('../sharepoint-client.js').OutcomeOption} OutcomeOption */
/** @typedef {import('../sharepoint-client.js').RemediationActionDefinition} RemediationActionDefinition */

import { outcomeResponseOptions } from '../evaluators/configured-outcome.js';

/**
 * Resolves the response options and their Outcome mapping for a compiled or
 * exported question. `outcome`-type questions derive both from the Case Type's
 * Outcomes (read-only); other types carry their own. Empty mappings collapse to
 * `null` so the caller can omit them.
 *
 * @param {DraftQuestion} q
 * @param {OutcomeOption[]} outcomeOptions
 * @returns {{ options: string[] | null, optionOutcomes: Record<string, string> | null }}
 */
export function resolveCompiledOptions(q, outcomeOptions = []) {
  if (q.responseType === 'outcome') {
    const derived = outcomeResponseOptions(outcomeOptions);
    return {
      options: derived.options.length ? derived.options : null,
      optionOutcomes: Object.keys(derived.optionOutcomes).length
        ? derived.optionOutcomes
        : null,
    };
  }
  return {
    options: q.options ?? null,
    optionOutcomes:
      q.optionOutcomes && Object.keys(q.optionOutcomes).length
        ? q.optionOutcomes
        : null,
  };
}

/**
 * The data-only projection of a bank's questions: the shape both the export
 * envelope and the version digest are built from, so a version's identity is
 * computed over exactly the content that version publishes.
 *
 * @param {QuestionBank} bank
 * @returns {Array<{
 * id: string,
 * text: string,
 * category: string | null,
 * questionGroup: string | null,
 * responseType: string,
 * options: string[] | null,
 * optionOutcomes: Record<string, string> | null,
 * showWhen: Record<string, unknown> | null,
 * remediationActions: Array<RemediationActionDefinition> | null,
 * deprecated: boolean,
 * labelIds?: string[],
 * }>}
 */
export function exportQuestions(bank) {
  const outcomeOptions = bank.outcomeOptions ?? [];
  return bank.questions.map((q) => {
    const resolved = resolveCompiledOptions(q, outcomeOptions);
    /** @type {any} */
    const out = {
      id: q.id,
      text: q.text,
      category: q.category ?? null,
      questionGroup: q.questionGroup ?? null,
      responseType: q.responseType,
      options: resolved.options,
      optionOutcomes: resolved.optionOutcomes,
      showWhen: q.showWhen ?? null,
      remediationActions: q.remediationActions
        ? q.remediationActions.map((action, index) =>
            typeof action === 'string'
              ? { id: `${q.id}-ra-${index}`, text: action }
              : { id: action.id, text: action.text }
          )
        : null,
      deprecated: q.deprecated,
    };
    if (q.labelIds && q.labelIds.length) out.labelIds = q.labelIds;
    return out;
  });
}

/**
 * THE version identity of a Question Bank: a lower-case hex SHA-256 over what
 * the version publishes — the slug, the projected questions, the Outcome
 * vocabulary and the default Outcome. `label` and `generatedAt` are left out so
 * that renaming a bank or republishing it on another day is not a new version.
 *
 * No algorithm prefix. The same value is stamped on a Case row, carried in the
 * envelope and composed into a filename, and `:` is illegal in a Windows path
 * and rejected by SharePoint, so a prefixed form could never reach the third.
 *
 * @param {QuestionBank} bank
 * @returns {Promise<string>}
 */
export async function bankVersionHash(bank) {
  const content = JSON.stringify({
    slug: bank.slug,
    questions: exportQuestions(bank),
    outcomeOptions: bank.outcomeOptions ?? [],
    defaultOutcomeId: bank.defaultOutcomeId ?? null,
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(content)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
