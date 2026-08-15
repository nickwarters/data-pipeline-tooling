// @ts-check
/**
 * Compile pipeline for the Question Bank curator workbench.
 *
 * compileBank(bank) → JSON text for case-types/banks/{slug}.txt current bank
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
  bankVersionHash,
  exportQuestions,
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
 * Data-only JSON export envelope for external reporting.
 *
 * Returns the function-free projection of the bank: slug, label, generatedAt,
 * its version identity, the projected questions, case-type
 * outcomeOptions/defaultOutcomeId, and a labels table. Excluded:
 * computeOutcome, disallowFreeFormRemediation, eligibleGroups.
 *
 * The identity and the questions come from the same projection
 * (`lib/bank-version.js`), so an envelope cannot carry a hash computed over
 * anything other than the content it is publishing.
 *
 * @param {QuestionBank} bank
 * @returns {Promise<{
 * slug: string,
 * label: string,
 * generatedAt: string,
 * hash: string,
 * questions: ReturnType<typeof exportQuestions>,
 * labels: Array<{ id: string, name: string, color: string }>,
 * outcomeOptions: import('../../sharepoint-client.js').OutcomeOption[],
 * defaultOutcomeId: string | null,
 * }>}
 */
export async function compileExport(bank) {
  return {
    slug: bank.slug,
    label: bank.label,
    generatedAt: new Date().toISOString(),
    hash: await bankVersionHash(bank),
    questions: exportQuestions(bank),
    labels: bank.labels ?? [],
    outcomeOptions: bank.outcomeOptions ?? [],
    defaultOutcomeId: bank.defaultOutcomeId ?? null,
  };
}

/**
 * @typedef {{ slug: string, versions: Array<{ hash: string, generatedAt: string }> }} VersionManifest
 */

/**
 * Builds the versioned publish artifacts.
 *
 * Given an export envelope (from `compileExport`) and the existing manifest
 * (or null on first publish), returns:
 * - `versionedJson`: JSON string for `{slug}.{hash}.json`; null when this hash
 * already exists in the manifest (idempotent re-publish — no write needed).
 * - `currentJson`: JSON string for `{slug}.json` (current-pointer, always updated).
 * - `manifest`: updated `{slug}.history.json` object with the new entry appended.
 * - `isNew`: false when the hash was already in the manifest.
 *
 * The caller is responsible for writing these artifacts to the Style Library.
 *
 * @param {{
 * slug: string,
 * label: string,
 * generatedAt: string,
 * hash: string,
 * questions: unknown[],
 * labels?: unknown[],
 * }} exportEnvelope
 * @param {VersionManifest | null} existingManifest
 * @returns {{
 * versionedJson: string | null,
 * currentJson: string,
 * manifest: VersionManifest,
 * isNew: boolean,
 * }}
 */
export function buildPublishArtifacts(exportEnvelope, existingManifest) {
  const { slug, hash, generatedAt } = exportEnvelope;
  const existingVersions = existingManifest?.versions ?? [];
  const isNew = !existingVersions.some((v) => v.hash === hash);
  const manifest = {
    slug,
    versions: isNew
      ? [...existingVersions, { hash, generatedAt }]
      : existingVersions.slice(),
  };
  const currentJson = JSON.stringify(exportEnvelope, null, 2);
  // Versioned file omits the labels table: label name/color is "presentation"
  // resolved from the current file so renames apply consistently across all
  // historical reports. labelIds per question are kept.
  const { labels: _labels, ...versionedEnvelope } = exportEnvelope;
  return {
    versionedJson: isNew ? JSON.stringify(versionedEnvelope, null, 2) : null,
    currentJson,
    manifest,
    isNew,
  };
}

/**
 * Store-effect wiring for publishing a bank. Compilation and artifact
 * construction remain the existing pure functions; the injected
 * writer is the only side effect.
 *
 * @param {import('./question-bank-source.js').QuestionBank} bank
 * @param {VersionManifest | null} existingManifest
 * @param {(artifacts: ReturnType<typeof buildPublishArtifacts>) => Promise<void>} write
 * @returns {Promise<ReturnType<typeof buildPublishArtifacts>>}
 */
export async function publishBankEffect(bank, existingManifest, write) {
  const envelope = await compileExport(bank);
  const artifacts = buildPublishArtifacts(envelope, existingManifest);
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
