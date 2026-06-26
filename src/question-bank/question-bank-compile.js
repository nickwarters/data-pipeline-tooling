// @ts-check
/**
 * Compile pipeline for the Question Bank curator workbench.
 *
 *   compileBank(bank)  → string of a case-types/{slug}.js module body
 *   highlight(code)    → HTML with syntax-coloured spans
 *   escapeHtml(s)      → HTML-safe text
 *   hashStr(s)         → first 6 bytes of SHA-256, hex (browser crypto)
 *
 * Everything here is pure (no DOM, no signals). The drawer component
 * orchestrates these in response to signal changes.
 */

/** @typedef {import('../../dev/fixtures/question-banks.js').QuestionBank} QuestionBank */
/** @typedef {import('../../dev/fixtures/question-banks.js').DraftQuestion} DraftQuestion */

/**
 * @param {QuestionBank} bank
 * @returns {string}
 */
export function compileBank(bank) {
  const lines = [];
  lines.push(`// @ts-check`);
  lines.push(
    `/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */`
  );
  lines.push(
    `/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */`
  );
  lines.push('');
  lines.push(`/** @type {CaseTypeConfig} */`);
  lines.push(`const config = {`);
  lines.push(`  eligibleGroups: ${JSON.stringify(bank.eligibleGroups)},`);
  if (bank.labels && bank.labels.length) {
    lines.push(`  labels: [`);
    for (const l of bank.labels) {
      lines.push(
        `    { id: ${JSON.stringify(l.id)}, name: ${JSON.stringify(l.name)}, color: ${JSON.stringify(l.color)} },`
      );
    }
    lines.push(`  ],`);
  }
  lines.push(`  questions: [`);
  for (const q of bank.questions) {
    lines.push(`    {`);
    lines.push(`      id: ${JSON.stringify(q.id)},`);
    lines.push(`      text: ${JSON.stringify(q.text)},`);
    if (q.category)
      lines.push(`      category: ${JSON.stringify(q.category)},`);
    if (q.labelIds && q.labelIds.length)
      lines.push(`      labelIds: ${JSON.stringify(q.labelIds)},`);
    lines.push(`      responseType: ${JSON.stringify(q.responseType)},`);
    if (q.options) lines.push(`      options: ${JSON.stringify(q.options)},`);
    if (q.showWhen)
      lines.push(`      showWhen: ${JSON.stringify(q.showWhen)},`);
    if (q.failureCriteria)
      lines.push(
        `      failureCriteria: ${JSON.stringify(q.failureCriteria)},`
      );
    if (q.remediationActions) {
      lines.push(`      remediationActions: [`);
      for (const r of q.remediationActions)
        lines.push(`        ${JSON.stringify(r)},`);
      lines.push(`      ],`);
    }
    if (q.allowFreeFormRemediation)
      lines.push(`      allowFreeFormRemediation: true,`);
    lines.push(`      deprecated: ${q.deprecated},`);
    lines.push(`    },`);
  }
  lines.push(`  ],`);
  lines.push('');
  lines.push(`  /** @param {Record<string, Answer>} answers */`);
  lines.push(`  computeOutcome(answers) {`);
  lines.push(
    `    const hasNo = Object.values(answers).some(a => a.value === 'No');`
  );
  lines.push(`    return { verdict: hasNo ? 'fail' : 'pass' };`);
  lines.push(`  },`);
  lines.push(`};`);
  lines.push('');
  lines.push(`export default config;`);
  return lines.join('\n');
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
        .map((k) => JSON.stringify(k) + ':' + canonicalise(/** @type {any} */ (value)[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

/**
 * Data-only JSON export envelope for external reporting (ADR-0015, ADR-0021).
 *
 * Returns the function-free projection of the bank: slug, label, generatedAt,
 * a full SHA-256 hash (stable over questions+slug only), and a questions array
 * that carries id/text/category/responseType/options/showWhen/failureCriteria/
 * deprecated. Excluded: computeOutcome, remediationActions,
 * allowFreeFormRemediation, eligibleGroups, labelIds (Step 5).
 *
 * @param {QuestionBank} bank
 * @returns {Promise<{
 *   slug: string,
 *   label: string,
 *   generatedAt: string,
 *   hash: string,
 *   questions: Array<{
 *     id: string,
 *     text: string,
 *     category: string | null,
 *     responseType: string,
 *     options: string[] | null,
 *     showWhen: Record<string, unknown> | null,
 *     failureCriteria: string | null,
 *     deprecated: boolean,
 *   }>,
 * }>}
 */
export async function compileExport(bank) {
  const questions = bank.questions.map((q) => ({
    id: q.id,
    text: q.text,
    category: q.category ?? null,
    responseType: q.responseType,
    options: q.options ?? null,
    showWhen: q.showWhen ?? null,
    failureCriteria: q.failureCriteria ?? null,
    deprecated: q.deprecated,
  }));

  const canonical = canonicalise({ slug: bank.slug, questions });
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
  };
}

/**
 * @typedef {{ slug: string, versions: Array<{ hash: string, generatedAt: string }> }} VersionManifest
 */

/**
 * Builds the versioned publish artifacts for ADR-0021 Step 2.
 *
 * Given an export envelope (from `compileExport`) and the existing manifest
 * (or null on first publish), returns:
 * - `versionedJson`: JSON string for `{slug}.{hash}.json`; null when this hash
 *   already exists in the manifest (idempotent re-publish — no write needed).
 * - `currentJson`: JSON string for `{slug}.json` (current-pointer, always updated).
 * - `manifest`: updated `{slug}.history.json` object with the new entry appended.
 * - `isNew`: false when the hash was already in the manifest.
 *
 * The caller is responsible for writing these artifacts to the Style Library.
 *
 * @param {{
 *   slug: string,
 *   label: string,
 *   generatedAt: string,
 *   hash: string,
 *   questions: unknown[],
 * }} exportEnvelope
 * @param {VersionManifest | null} existingManifest
 * @returns {{
 *   versionedJson: string | null,
 *   currentJson: string,
 *   manifest: VersionManifest,
 *   isNew: boolean,
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
  return {
    versionedJson: isNew ? currentJson : null,
    currentJson,
    manifest,
    isNew,
  };
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
