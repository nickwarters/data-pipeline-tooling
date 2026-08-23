// @ts-check
/**
 * Compile pipeline for the Question Bank curator workbench.
 *
 * compileBank(bank) → JSON text for case-types/banks/{slug}.txt current bank
 * compileExport(bank) → the envelope of one published version, {slug}.{version}.txt
 * highlight(code) → HTML with syntax-coloured spans
 * escapeHtml(s) → HTML-safe text
 * hashStr(s) → first 6 bytes of SHA-256, hex (browser crypto)
 *
 * Everything here is pure (no DOM, no signals). The drawer component
 * orchestrates these in response to signal changes.
 */

/** @typedef {import('./question-bank-source.js').QuestionBank} QuestionBank */
/** @typedef {import('./question-bank-source.js').DraftQuestion} DraftQuestion */

import {
  declaredBankVersion,
  exportQuestions,
  mintBankVersion,
  publishedContent,
  resolveCompiledOptions,
} from '../../lib/bank-version.js';

// `resolveCompiledOptions` moved to lib/bank-version.js with the export
// projection it belongs to; the editor and the simulator still reach it here.
export { resolveCompiledOptions };

/**
 * @param {QuestionBank} bank
 * @returns {string}
 */
export function compileBank(bank) {
  return `${JSON.stringify(
    {
      slug: bank.slug,
      label: bank.label,
      // The version identity and its timeline are part of the artifact, not
      // of the content: carried through untouched so compiling a bank never
      // moves or forgets what version it is.
      ...(bank.version !== undefined ? { version: bank.version } : {}),
      ...(bank.history !== undefined ? { history: bank.history } : {}),
      questions: compileBankQuestions(bank),
      ...(bank.labels?.length ? { labels: bank.labels } : {}),
      ...(bank.outcomeOptions?.length
        ? { outcomeOptions: bank.outcomeOptions }
        : {}),
      ...(bank.defaultOutcomeId
        ? { defaultOutcomeId: bank.defaultOutcomeId }
        : {}),
    },
    null,
    2
  )}\n`;
}

/**
 * @param {QuestionBank} bank
 * @returns {DraftQuestion[]}
 */
function compileBankQuestions(bank) {
  return bank.questions.map((question) => {
    const resolved = resolveCompiledOptions(
      question,
      bank.outcomeOptions ?? []
    );
    // Failure is derived from optionOutcomes at load, never stored: shed any
    // legacy authored `failureCriteria` still present in an old artifact.
    const { failureCriteria: _dropLegacy, ...rest } =
      /** @type {DraftQuestion & { failureCriteria?: string }} */ (question);
    return {
      ...rest,
      options: resolved.options ?? undefined,
      optionOutcomes: resolved.optionOutcomes ?? undefined,
    };
  });
}

/**
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] ?? c
  );
}

/**
 * Lightweight regex-based highlighter; produces <span class="c|s|k|b|p"> spans.
 *
 * @param {string} code
 * @returns {string}
 */
export function highlight(code) {
  return escapeHtml(code)
    .replace(/(\/\/[^\n]*)/g, '<span class="c">$1</span>')
    .replace(
      /(&#39;[^&]*?&#39;|&quot;[^&]*?&quot;)/g,
      '<span class="s">$1</span>'
    )
    .replace(
      /\b(const|export|default|function|return|some|of)\b/g,
      '<span class="k">$1</span>'
    )
    .replace(/\b(true|false)\b/g, '<span class="b">$1</span>')
    .replace(/(\b[a-zA-Z_][\w]*)(?=:)/g, '<span class="p">$1</span>');
}

/**
 * Data-only JSON export envelope for external reporting: the body of one
 * published version.
 *
 * Returns the function-free projection of the bank: slug, label, generatedAt,
 * its version identity, the projected questions, case-type
 * outcomeOptions/defaultOutcomeId, and a labels table. Excluded:
 * computeOutcome, disallowFreeFormRemediation, eligibleGroups.
 *
 * The version is **read off the bank**, never computed here: the bank declares
 * what version it is, and the envelope — and the filename composed from it —
 * carry that declaration. A bank that declares none cannot be published as a
 * version, so this refuses rather than inventing one.
 *
 * @param {QuestionBank} bank
 * @returns {Promise<{
 * slug: string,
 * label: string,
 * generatedAt: string,
 * version: string,
 * questions: ReturnType<typeof exportQuestions>,
 * labels: Array<{ id: string, name: string, color: string }>,
 * outcomeOptions: import('../../sharepoint-client.js').OutcomeOption[],
 * defaultOutcomeId: string | null,
 * }>}
 */
export async function compileExport(bank) {
  const version = declaredBankVersion(bank);
  if (!version) {
    throw new Error(
      `Question Bank "${bank.slug}" declares no version — set its \`version\` before publishing it`
    );
  }
  return {
    slug: bank.slug,
    label: bank.label,
    generatedAt: new Date().toISOString(),
    version,
    ...publishedContent(bank),
    labels: bank.labels ?? [],
  };
}

/**
 * Builds the versioned publish artifacts.
 *
 * Given an export envelope (from `compileExport`) and the bank it was compiled
 * from, returns:
 * - `versionedJson`: JSON string for `{slug}.{version}.txt`; null when the
 * bank's history already records this version (idempotent re-publish — no
 * write needed).
 * - `bankJson`: JSON string for `{slug}.txt` — the bank with its `version` set
 * to the envelope's and that version appended to its `history` when new. The
 * bank's history is the timeline: there is no separate manifest to keep in
 * step with it.
 * - `isNew`: false when the version was already in the history.
 *
 * The caller is responsible for writing these artifacts to the Style Library.
 *
 * @param {{
 * slug: string,
 * label: string,
 * generatedAt: string,
 * version: string,
 * questions: unknown[],
 * labels?: unknown[],
 * }} exportEnvelope
 * @param {QuestionBank} bank
 * @returns {{
 * versionedJson: string | null,
 * bankJson: string,
 * isNew: boolean,
 * }}
 */
export function buildPublishArtifacts(exportEnvelope, bank) {
  const { version, generatedAt } = exportEnvelope;
  const history = bank.history ?? [];
  const isNew = !history.some((entry) => entry.version === version);
  const bankJson = compileBank({
    ...bank,
    version,
    history: isNew ? [...history, { version, generatedAt }] : history.slice(),
  });
  // Versioned file omits the labels table: label name/color is "presentation"
  // resolved from the current bank so renames apply consistently across all
  // historical reports. labelIds per question are kept.
  const { labels: _labels, ...versionedEnvelope } = exportEnvelope;
  return {
    versionedJson: isNew ? JSON.stringify(versionedEnvelope, null, 2) : null,
    bankJson,
    isNew,
  };
}

/**
 * Store-effect wiring for publishing a bank from the editor. Publishing an
 * edited bank means a **new** version, so one is minted for it here; the
 * compilation and artifact construction remain the pure functions above, and
 * the injected writer is the only side effect.
 *
 * @param {import('./question-bank-source.js').QuestionBank} bank
 * @param {(artifacts: ReturnType<typeof buildPublishArtifacts>) => Promise<void>} write
 * @returns {Promise<ReturnType<typeof buildPublishArtifacts>>}
 */
export async function publishBankEffect(bank, write) {
  const versioned = { ...bank, version: await mintBankVersion(bank) };
  const envelope = await compileExport(versioned);
  const artifacts = buildPublishArtifacts(envelope, versioned);
  await write(artifacts);
  return artifacts;
}

/**
 * @param {string} s
 * @returns {Promise<string>}
 */
export async function hashStr(s) {
  const buf = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)]
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
