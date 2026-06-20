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
  lines.push(`  questions: [`);
  for (const q of bank.questions) {
    lines.push(`    {`);
    lines.push(`      id: ${JSON.stringify(q.id)},`);
    lines.push(`      text: ${JSON.stringify(q.text)},`);
    if (q.category)
      lines.push(`      category: ${JSON.stringify(q.category)},`);
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
