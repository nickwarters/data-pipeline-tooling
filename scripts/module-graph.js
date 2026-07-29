// @ts-check

/**
 * Module-graph scanning, shared by the layering contract test and the verify
 * gate. Both need the same answer to "what does this file import?", so the
 * regexes and the comment handling live here once.
 *
 * The scanner is deliberately textual: reading the bytes is the only way to ask
 * the question without evaluating a module, and evaluating pages or Case Type
 * modules would run their side effects. Two phantom edges are the price, both
 * inherent to reading text rather than parsing it: an import written inside a
 * multi-line block comment, and one written inside a string literal, are both
 * reported as edges.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Static import forms, one per line of source:
 *   `import './x.js'`            side-effect import
 *   `import a, { b } from './x'` named/default import
 *   `export { a } from './x'`    re-export (real: lib/case-machine.js does this)
 *   `export * from './x'`        star re-export
 *   `} from './x'`               the tail of a multi-line named import/export
 *
 * A specifier is only accepted when `import` or `from` introduces it, so an
 * ordinary `export const X = 'value'` is not mistaken for an edge.
 */
const STATIC_IMPORT =
  /^[ \t]*(?:import[ \t]+(?:[^'"\n]*?\bfrom[ \t]+)?|export[ \t][^'"\n]*?\bfrom[ \t]+|\}?[ \t]*from[ \t]+)['"]([^'"\n]+)['"]/gm;

/**
 * Dynamic `import('…')`. The lookbehind rejects member expressions and
 * identifiers ending in `import`, so only the real operator is matched.
 */
const DYNAMIC_IMPORT = /(?<![\w$.])import\(\s*['"]([^'"\n]+)['"]/g;

/** @typedef {'static' | 'dynamic'} ImportKind */
/** @typedef {{ specifier: string, kind: ImportKind, line: number }} ImportEdge */

/**
 * Repo-relative path of a file URL, with forward slashes on every platform.
 * @param {URL} url @param {URL} root @returns {string}
 */
function relativeTo(url, root) {
  return relative(fileURLToPath(root), fileURLToPath(url)).split(sep).join('/');
}

/**
 * Every `.js` file under a directory, as repo-relative paths.
 * @param {URL} dir @param {URL} root @returns {string[]}
 */
export function jsFilesUnder(dir, root) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(
      encodeURIComponent(entry.name) + (entry.isDirectory() ? '/' : ''),
      dir
    );
    if (entry.isDirectory()) out.push(...jsFilesUnder(child, root));
    else if (entry.name.endsWith('.js')) out.push(relativeTo(child, root));
  }
  return out;
}

/**
 * Read a source file with comments blanked out. JSDoc type references and
 * inline type casts both mention modules in the same shape a real import uses,
 * and neither is an edge: nothing is loaded at runtime. Whole-line comments are
 * blanked, and so are block comments that open and close within a line — the
 * inline cast form, which a line filter alone would leave behind.
 *
 * Line numbers are preserved: comment lines become empty lines and
 * inline block comments become whitespace, so a match index still maps to the
 * line the reader will look at.
 *
 * @param {string} rel @param {URL} root @returns {string}
 */
export function readCode(rel, root) {
  return readFileSync(new URL(rel, root), 'utf8')
    .split('\n')
    .map((line) => {
      const withoutInlineBlocks = line.replace(/\/\*.*?\*\//g, ' ');
      return /^\s*(\*|\/\/|\/\*)/.test(withoutInlineBlocks)
        ? ''
        : withoutInlineBlocks;
    })
    .join('\n');
}

/**
 * Every import specifier in a file, in source order.
 * @param {string} rel @param {URL} root @returns {ImportEdge[]}
 */
export function importSpecifiers(rel, root) {
  const code = readCode(rel, root);
  /** @type {ImportEdge[]} */
  const edges = [];
  for (const [re, kind] of /** @type {[RegExp, ImportKind][]} */ ([
    [STATIC_IMPORT, 'static'],
    [DYNAMIC_IMPORT, 'dynamic'],
  ])) {
    for (const match of code.matchAll(re)) {
      edges.push({
        specifier: match[1],
        kind,
        line: lineOf(code, match.index),
      });
    }
  }
  return edges.sort((a, b) => a.line - b.line);
}

/**
 * 1-based line number of a match index.
 * @param {string} code @param {number} index @returns {number}
 */
function lineOf(code, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (code[i] === '\n') line += 1;
  return line;
}

/**
 * Repo-relative path a relative specifier resolves to, or null when the
 * specifier is not relative (a built-in scheme or a bare package name).
 * @param {string} fromRel @param {string} spec @param {URL} root
 * @returns {string | null}
 */
export function resolveRelative(fromRel, spec, root) {
  if (!spec.startsWith('.')) return null;
  return relativeTo(new URL(spec, new URL(fromRel, root)), root);
}
