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

import { outcomeResponseOptions } from '../../evaluators/configured-outcome.js';

/**
 * Resolves the response options and their Outcome mapping for a compiled/exported
 * question. `outcome`-type questions derive both from the Case Type's Outcomes
 * (read-only); other types carry their own. Empty mappings collapse to `null` so
 * the caller can omit them.
 *
 * @param {DraftQuestion} q
 * @param {import('../../sharepoint-client.js').OutcomeOption[]} outcomeOptions
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
 * Returns a canonical JSON string with object keys sorted alphabetically at
 * every nesting level. Arrays preserve their order. Used to produce a
 * stable hash input regardless of how question objects were constructed.
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
 * Data-only JSON export envelope for external reporting.
 *
 * Returns the function-free projection of the bank: slug, label, generatedAt,
 * a full SHA-256 hash (stable over questions+slug only, including labelIds),
 * a questions array that carries id/text/category/questionGroup/responseType/options/
 * optionOutcomes/showWhen/remediationActions/labelIds/deprecated,
 * case-type outcomeOptions/defaultOutcomeId, and a labels table. Excluded: computeOutcome,
 * allowFreeFormRemediation, eligibleGroups.
 *
 * @param {QuestionBank} bank
 * @returns {Promise<{
 * slug: string,
 * label: string,
 * generatedAt: string,
 * hash: string,
 * questions: Array<{
 * id: string,
 * text: string,
 * category: string | null,
 * questionGroup: string | null,
 * responseType: string,
 * options: string[] | null,
 * optionOutcomes: Record<string, string> | null,
 * showWhen: Record<string, unknown> | null,
 * remediationActions: Array<import('../../sharepoint-client.js').RemediationActionDefinition> | null,
 * deprecated: boolean,
 * labelIds?: string[],
 * }>,
 * labels: Array<{ id: string, name: string, color: string }>,
 * outcomeOptions: import('../../sharepoint-client.js').OutcomeOption[],
 * defaultOutcomeId: string | null,
 * }>}
 */
export async function compileExport(bank) {
  const outcomeOptions = bank.outcomeOptions ?? [];
  const questions = bank.questions.map((q) => {
    const resolved = resolveCompiledOptions(q, outcomeOptions);
    /** @type {{ id: string, text: string, category: string|null, questionGroup: string|null, responseType: string, options: string[]|null, optionOutcomes: Record<string, string>|null, showWhen: Record<string,unknown>|null, remediationActions: Array<import('../../sharepoint-client.js').RemediationActionDefinition>|null, deprecated: boolean, labelIds?: string[] }} */
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

  const canonical = canonicalise({
    slug: bank.slug,
    questions,
    outcomeOptions,
    defaultOutcomeId: bank.defaultOutcomeId ?? null,
  });
  const buf = new TextEncoder().encode(canonical);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  const hashHex = [...new Uint8Array(hashBuf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    slug: bank.slug,
    label: bank.label,
    generatedAt: new Date().toISOString(),
    hash: `sha256:${hashHex}`,
    questions,
    labels: bank.labels ?? [],
    outcomeOptions,
    defaultOutcomeId: bank.defaultOutcomeId ?? null,
  };
}

/**
 * @typedef {{ slug: string, versions: Array<{ hash: string, generatedAt: string }> }} VersionManifest
 */

/**
 * Builds the versioned publish artifacts for the architecture decision Step 2.
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
 * construction remain the existing pure ADR-0021 functions; the injected
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
