// @ts-check
/**
 * A Question Bank's version identity, and the export projection it is computed
 * over.
 *
 * The identity of a bank version is **derived from the bank, not stored beside
 * it**. There is no current-version pointer file: `case-types/banks/{slug}.txt`
 * is the current version, and this is the one function that says what its
 * identity is. A stored pointer would be a second statement of the same fact,
 * and the two can disagree — a bank edited without republishing would keep
 * claiming the old version, and a Case completed against it would freeze on
 * content the Reviewer never saw. A derived identity cannot drift, because
 * there is nothing to keep in step.
 *
 * The digest covers **semantic content only** — `slug`, the projected
 * questions, the Outcome vocabulary and the default Outcome. It deliberately
 * excludes `label`, `generatedAt` and the `hash` field itself, so republishing
 * identical questions yields the identical version regardless of when it was
 * published or how the file was formatted. That exclusion is also why an
 * artifact's `hash` field can be rewritten without moving its identity.
 *
 * This lives in `lib/` rather than with the Question Bank editor because it is
 * no longer only the compiler's concern: the SharePoint clients ask what the
 * current version is on the path that stamps a Case.
 *
 * **On recomputation.** The recorded rule is that readers treat the hash as
 * opaque and never recompute it, because JS and Python will not agree
 * byte-for-byte on a canonical form. That reasoning is about *crossing
 * languages*, and it still holds: nothing outside JavaScript computes an
 * identity. Inside JavaScript there is exactly one implementation — this one —
 * so the compiler, the app and the publish script cannot disagree with each
 * other about what a bank's version is.
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
 * A canonical JSON string with object keys sorted alphabetically at every
 * nesting level. Arrays preserve their order.
 *
 * Canonical rather than pretty-printed on purpose: the digest is over a
 * normalised data form, so reformatting a file — by the repository formatter,
 * or by a change in how the emitter indents — cannot silently re-identify
 * identical content.
 *
 * @param {unknown} value
 * @returns {string}
 */
function canonicalise(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalise).join(',') + ']';
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(/** @type {object} */ (value)).sort();
    return (
      '{' +
      keys
        .map(
          (k) =>
            JSON.stringify(k) +
            ':' +
            canonicalise(/** @type {any} */ (value)[k])
        )
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

/**
 * THE version identity of a Question Bank: the lower-case hex SHA-256 of its
 * canonical content, and nothing else.
 *
 * No algorithm prefix. The identity is stamped on a Case row, carried in the
 * envelope, and composed into a filename, and a `sha256:` prefix would have to
 * survive all three — but `:` is illegal in a Windows path and rejected by
 * SharePoint, so it could never reach the third. One form everywhere beats a
 * form that has to be stripped at the edge. The digest's own length is what
 * says which algorithm produced it.
 *
 * @param {QuestionBank} bank
 * @returns {Promise<string>}
 */
export async function bankVersionHash(bank) {
  const canonical = canonicalise({
    slug: bank.slug,
    questions: exportQuestions(bank),
    outcomeOptions: bank.outcomeOptions ?? [],
    defaultOutcomeId: bank.defaultOutcomeId ?? null,
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
