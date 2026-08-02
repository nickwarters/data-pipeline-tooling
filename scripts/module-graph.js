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
 * Every file under a directory, whatever its suffix, as repo-relative paths.
 * A missing directory throws: every caller here names a directory it expects to
 * exist, and a silent empty list would let a rename turn a contract check into a
 * vacuous pass.
 * @param {URL} dir @param {URL} root @returns {string[]}
 */
export function filesUnder(dir, root) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(
      encodeURIComponent(entry.name) + (entry.isDirectory() ? '/' : ''),
      dir
    );
    if (entry.isDirectory()) out.push(...filesUnder(child, root));
    else out.push(relativeTo(child, root));
  }
  return out;
}

/**
 * Every `.js` file under a directory, as repo-relative paths.
 * @param {URL} dir @param {URL} root @returns {string[]}
 */
export function jsFilesUnder(dir, root) {
  return filesUnder(dir, root).filter((rel) => rel.endsWith('.js'));
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
 * An `import('<module>')` call, optionally with the member reached off it. The
 * member matters — `import('<module>').PageState` consumes only `PageState`,
 * while a bare `typeof import('<module>')` consumes the whole namespace.
 *
 * The examples are written with an unresolvable placeholder on purpose: this
 * pattern is matched against raw bytes, comments included, so a real specifier
 * spelled here would make this comment a reader of that module.
 */
const TYPE_IMPORT =
  /import\(\s*['"](\.[^'"\n]+)['"]\s*\)(?:\s*\.\s*([A-Za-z_$][\w$]*))?/g;

/** @typedef {{ specifier: string, name: string }} TypeReference */

/**
 * Every relative `import('…')` in a file, read from the RAW bytes rather than
 * `readCode()` — this is the one scanner that must see comments. Its reason for
 * existing is the JSDoc type annotation: a module that exports nothing but
 * typedefs has no other kind of reader, and a name used only as a type has no
 * other kind of consumer, so ignoring comments here would report both as dead.
 *
 * It does not distinguish a type annotation from a runtime dynamic import,
 * because the raw bytes do not carry that distinction and the imprecision costs
 * nothing: `importedNames` already records `'*'` for a real dynamic import, and
 * a consumer reads the union of the two, so a member captured here can only add
 * to what a specifier is read for — never narrow a `'*'` back to one name.
 *
 * Counting a reference can only suppress a report, never invent one, which is
 * the safe direction for a gate that deletes code. The accepted cost is the
 * mirror of that: a specifier written in a comment keeps its target alive until
 * someone deletes the comment too.
 *
 * `name` is the member reached off the call, or `'*'` when nothing is.
 *
 * @param {string} rel @param {URL} root @returns {TypeReference[]}
 */
export function typeReferences(rel, root) {
  const text = readFileSync(new URL(rel, root), 'utf8');
  return [...text.matchAll(TYPE_IMPORT)].map((match) => ({
    specifier: match[1],
    name: match[2] ?? '*',
  }));
}

/**
 * A name exported by a declaration: `export const x`, `export function x`,
 * `export async function* x`, `export class X`.
 */
const EXPORT_DECLARATION =
  /^[ \t]*export[ \t]+(?:async[ \t]+)?(?:function\*?|class|const|let|var)[ \t]+([A-Za-z_$][\w$]*)/gm;

/** An export clause, with or without a `from`: `export { a, b as c } from './x'`. */
const EXPORT_CLAUSE =
  /^[ \t]*export[ \t]*\{([^}]*)\}[ \t]*(?:from[ \t]*['"]([^'"\n]+)['"])?/gm;

const EXPORT_DEFAULT = /^[ \t]*export[ \t]+default\b/gm;

/** @typedef {{ name: string, line: number }} ExportedName */

/**
 * Every name a module exports, with the line it is exported on.
 *
 * Two forms are deliberately not matched, neither of which occurs in this tree:
 * a multi-declarator `export const A = 1, B = 2` (only `A` is seen) and a
 * destructured `export const { a } = obj` (nothing is seen).
 *
 * @param {string} rel @param {URL} root @returns {ExportedName[]}
 */
export function exportedNames(rel, root) {
  const code = readCode(rel, root);
  /** @type {ExportedName[]} */
  const names = [];
  for (const match of code.matchAll(EXPORT_DECLARATION)) {
    names.push({ name: match[1], line: lineOf(code, match.index) });
  }
  for (const match of code.matchAll(EXPORT_CLAUSE)) {
    const line = lineOf(code, match.index);
    for (const name of clauseNames(match[1], 'exported'))
      names.push({ name, line });
  }
  for (const match of code.matchAll(EXPORT_DEFAULT)) {
    names.push({ name: 'default', line: lineOf(code, match.index) });
  }
  return names.sort((a, b) => a.line - b.line);
}

/**
 * The names in a `{ … }` clause. `a as b` names two different things depending
 * on the direction: the source module is read for `a`, and `b` is what the
 * reading module goes on to call it — or, in a re-export, what it publishes.
 *
 * @param {string} clause @param {'exported' | 'imported'} side
 * @returns {string[]}
 */
function clauseNames(clause, side) {
  return clause
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [local, alias] = part.split(/\s+as\s+/).map((word) => word.trim());
      return side === 'exported' ? (alias ?? local) : local;
    })
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

/**
 * A static import or re-export with a clause: the clause text and the module it
 * is read from.
 */
const IMPORT_CLAUSE =
  /^[ \t]*import[ \t]+([^'";]*?)[ \t]*from[ \t]*['"]([^'"\n]+)['"]/gm;
const REEXPORT_CLAUSE =
  /^[ \t]*export[ \t]*(\{[^}]*\}|\*)[ \t]*from[ \t]*['"]([^'"\n]+)['"]/gm;

/** @typedef {{ specifier: string, names: string[] | '*' }} ImportedNames */

/**
 * Which names a module reads out of each of its dependencies.
 *
 * `'*'` means "every name": a namespace import, a `export * from`, or a dynamic
 * `import()`, whose namespace object hides which properties the caller reads.
 *
 * @param {string} rel @param {URL} root @returns {ImportedNames[]}
 */
export function importedNames(rel, root) {
  const code = readCode(rel, root);
  /** @type {{ entry: ImportedNames, index: number }[]} */
  const found = [];
  for (const match of code.matchAll(IMPORT_CLAUSE)) {
    found.push({
      entry: { specifier: match[2], names: clauseOf(match[1]) },
      index: match.index,
    });
  }
  for (const match of code.matchAll(REEXPORT_CLAUSE)) {
    found.push({
      entry: {
        specifier: match[2],
        names:
          match[1] === '*'
            ? '*'
            : clauseNames(match[1].slice(1, -1), 'imported'),
      },
      index: match.index,
    });
  }
  for (const match of code.matchAll(DYNAMIC_IMPORT)) {
    found.push({
      entry: { specifier: match[1], names: '*' },
      index: match.index,
    });
  }
  return found.sort((a, b) => a.index - b.index).map(({ entry }) => entry);
}

/**
 * The names an import clause reads: a leading bare identifier is the default
 * export, `* as ns` is everything, and a brace clause names each one.
 * @param {string} clause @returns {string[] | '*'}
 */
function clauseOf(clause) {
  if (/^\*/.test(clause.trim())) return '*';
  const brace = clause.indexOf('{');
  const head = (brace === -1 ? clause : clause.slice(0, brace)).replace(
    /,\s*$/,
    ''
  );
  /** @type {string[]} */
  const names = [];
  if (/^[A-Za-z_$][\w$]*$/.test(head.trim())) names.push('default');
  if (brace !== -1) {
    names.push(
      ...clauseNames(
        clause.slice(brace + 1, clause.lastIndexOf('}')),
        'imported'
      )
    );
  }
  return names;
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
