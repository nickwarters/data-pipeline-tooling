// @ts-check
/**
 * A Question Bank's version identity: what it is, where it is declared, and the
 * one place a new one is minted.
 *
 * A version identity is just an **identifier** — a way to say "this bank" and
 * "that other bank" and to name a file. It is **declared, not derived**: the
 * bank artifact carries it as its `version` field, the published copy carries
 * the same value as *its* `version` field and in its filename, and the Case row
 * that freezes against it stamps that value verbatim. Nothing on the stamping
 * path computes anything — a Case reaching the reportable milestone is stamped
 * with what the bank *says* its version is.
 *
 * That has to be so because the identifier is hand-maintained. Whoever changes
 * a bank decides its next version and writes it into the bank and into the
 * published copy's name. How they arrive at the value is their business: a
 * content hash is a good choice (it changes when the content does, and it is
 * unique) and `mintBankVersion` below offers one — but `0001`, `0002` would
 * satisfy every consumer just as well, and an identifier minted by any other
 * tool is as good as one minted here. Recomputing it anywhere would be a bug:
 * two implementations that disagree by a byte would stamp a Case with a version
 * no file answers to.
 *
 * The bank also carries its own `history` — the ordered list of every version
 * it has been published as, oldest first, the current one last. That is the
 * timeline the published files alone cannot give, since an identifier carries
 * no order.
 *
 * This lives in `lib/` rather than with the Question Bank editor because the
 * publish script and the repository gate both need the projection a version
 * publishes, and the gate needs to hold a bank's declared version to the copy
 * that version names.
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
 * Everything a version publishes, and therefore everything a version is a
 * version *of*: the projected questions, the Outcome vocabulary and the default
 * Outcome. `label`, `generatedAt` and the bank's own `version`/`history` are
 * not content — renaming a bank or republishing it on another day is not a new
 * version.
 *
 * Two places compare this: the repository gate, which holds the bank's declared
 * `version` to the published copy it names (the bank was edited, the version
 * was not bumped — the one mistake a hand-maintained identifier invites), and
 * `scripts/publish-bank.js`, which asks the same question before deciding
 * whether there is anything to publish.
 *
 * @param {QuestionBank} bank
 * @returns {{
 * questions: ReturnType<typeof exportQuestions>,
 * outcomeOptions: OutcomeOption[],
 * defaultOutcomeId: string | null,
 * }}
 */
export function publishedContent(bank) {
  return {
    questions: exportQuestions(bank),
    outcomeOptions: bank.outcomeOptions ?? [],
    defaultOutcomeId: bank.defaultOutcomeId ?? null,
  };
}

/**
 * The version identity a bank declares, or null when it declares none. This is
 * what the SharePoint clients stamp onto a Case row at the reportable
 * milestone. It is read, never computed.
 *
 * @param {unknown} bank a parsed bank artifact
 * @returns {string | null}
 */
export function declaredBankVersion(bank) {
  if (!bank || typeof bank !== 'object') return null;
  const version = /** @type {{ version?: unknown }} */ (bank).version;
  return typeof version === 'string' && version !== '' ? version : null;
}

/**
 * The one rule a version identifier has to satisfy: it is a filename segment.
 * Lower-case letters, digits, `-` and `_` only — lower-case because the
 * filesystems that serve it (Windows, SharePoint) are case-insensitive, so two
 * identifiers differing only in case would name one file; no `:` or `/`
 * because they are illegal in a path; no `.` because the first dot in an
 * artifact name is what separates the slug from the version.
 *
 * @param {unknown} value
 * @returns {value is string}
 */
export function isBankVersionIdentifier(value) {
  return typeof value === 'string' && /^[a-z0-9_-]+$/.test(value);
}

/**
 * Mint a **new** version identifier for a bank: a lower-case hex SHA-256 over
 * the slug and what the version publishes.
 *
 * This is a convenience for whoever is publishing a changed bank, offered
 * because a content hash makes a good identifier — it is unique, and an
 * unchanged bank mints the same one, so publishing twice is harmless. It is
 * **not** how the current version is found: that is declared on the bank, and
 * a hand-entered identifier or one minted by a Python script is exactly as
 * valid as one minted here. Nothing in the app calls this; only the publish
 * script does.
 *
 * No algorithm prefix, so the value can be a filename as-is.
 *
 * @param {QuestionBank} bank
 * @returns {Promise<string>}
 */
export async function mintBankVersion(bank) {
  const content = JSON.stringify({
    slug: bank.slug,
    ...publishedContent(bank),
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(content)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
