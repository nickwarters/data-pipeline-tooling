// @ts-check

/**
 * Provenance contract: prose stands on its own, and `.js` cites nothing.
 *
 * A find-and-replace once swept the repository and turned every `ADR-00NN`
 * token into the literal phrase "the architecture decision". It substituted
 * rather than removed, so 317 lines across 44 files ended up carrying the cost
 * of both approaches and the benefit of neither: the provenance became
 * unusable — two distinct decisions collapse into one indistinguishable
 * phrase — and the prose reads as editorial filler. Wherever the reference had
 * been a noun phrase it also produced "the the architecture decision"; wherever
 * it had been a Markdown reference-link label it produced a block of identical
 * definitions, so every link in the file resolved to whichever duplicate the
 * renderer happened to pick.
 *
 * The repair was a rewrite per site, but a repair alone does not hold. The
 * phrase re-entered CONTEXT.md twice under later commits, written by hand as a
 * deliberate euphemism — which is the argument for a ratchet rather than a
 * one-off cleanup.
 *
 * Three rules:
 *
 *  1. The stock phrase appears nowhere outside `docs/adr/`. A vague gesture at
 *     "an architecture decision" is the defect, not the number that used to be
 *     attached to it — if the sentence cannot stand without the citation, the
 *     claim belongs in the decision record instead.
 *  2. No `the the` anywhere. This is the substitution's grammatical wreckage,
 *     and there is no legitimate occurrence.
 *  3. No `ADR-` reference in a `.js` file. A comment explains why the code is
 *     the way it is, in its own words, so it reads without the decision index
 *     open.
 *
 * `docs/adr/` is exempt from rule 1 for the obvious reason: a decision record
 * that supersedes or amends another has to name it, and it does so through
 * real links whose labels carry real numbers.
 *
 * Rule 3 deliberately stops at `ADR-`. Extending it to bare `#NNN` would fire
 * on HTML entities and on Case reference numbers like `Example Review #10`,
 * which are legitimate domain values; a regex there costs more than it catches.
 * Nor does it cover `.css`, `.py` or `.html` — those carry references today and
 * whether the rule reaches them is an open question, not a settled one.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url);

const SCANNED_DIRS = [
  'case-types/',
  'dev/',
  'docs/',
  'host/',
  'scripts/',
  'src/',
  'tests/',
];
const SCANNED_ROOT_FILES = ['CLAUDE.md', 'CONTEXT.md', 'README.md'];
const SCANNED_EXTENSIONS = ['.js', '.md', '.html', '.css', '.txt', '.py'];

// A detector has to name what it detects, so this file quotes all three
// patterns — in the prose above and in the fixture at the bottom — and is the
// one file exempt from every rule it enforces.
const SELF = 'tests/provenance-contract.test.js';

/**
 * @param {URL} dir
 * @returns {string[]} repo-relative paths of every scannable file beneath it
 */
function filesUnder(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) out.push(...filesUnder(child));
    else if (SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext)))
      out.push(child.pathname.slice(ROOT.pathname.length));
  }
  return out;
}

const scanned = [
  ...SCANNED_DIRS.flatMap((dir) => filesUnder(new URL(dir, ROOT))),
  ...SCANNED_ROOT_FILES,
].filter((rel) => rel !== SELF);

/**
 * @param {string} rel @param {string} text
 * @returns {string[]} `path:line` for each line carrying the stock phrase
 */
export function stockPhraseSites(rel, text) {
  return linesMatching(rel, text, /the architecture decision/i);
}

/**
 * @param {string} rel @param {string} text
 * @returns {string[]} `path:line` for each doubled article
 */
export function doubledArticleSites(rel, text) {
  return linesMatching(rel, text, /\bthe the\b/i);
}

/**
 * @param {string} rel @param {string} text
 * @returns {string[]} `path:line` for each decision-record citation
 */
export function adrCitationSites(rel, text) {
  return linesMatching(rel, text, /ADR-\d/);
}

/**
 * @param {string} rel @param {string} text @param {RegExp} pattern
 * @returns {string[]}
 */
function linesMatching(rel, text, pattern) {
  return text
    .split('\n')
    .map((line, i) => (pattern.test(line) ? `${rel}:${i + 1}` : ''))
    .filter(Boolean);
}

/** @param {string} rel @returns {string} */
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

test('the provenance scan reaches the whole repository', () => {
  assert.ok(
    scanned.filter((rel) => rel.startsWith('src/')).length > 50,
    'expected the scan to cover the whole of src/'
  );
  assert.ok(
    scanned.some((rel) => rel.startsWith('docs/adr/')),
    'expected the scan to reach the decision records'
  );
  assert.ok(
    scanned.includes('CONTEXT.md'),
    'expected the scan to reach the domain-language reference'
  );
});

test('the stock phrase appears nowhere outside the decision records', () => {
  const offenders = scanned
    .filter((rel) => !rel.startsWith('docs/adr/'))
    .flatMap((rel) => stockPhraseSites(rel, read(rel)));
  assert.deepEqual(
    offenders,
    [],
    'write the sentence so it stands on its own — a claim that needs the citation belongs in the decision record instead'
  );
});

test('no doubled article anywhere', () => {
  const offenders = scanned.flatMap((rel) =>
    doubledArticleSites(rel, read(rel))
  );
  assert.deepEqual(offenders, []);
});

test('no decision-record citation in a .js file', () => {
  const offenders = scanned
    .filter((rel) => rel.endsWith('.js'))
    .flatMap((rel) => adrCitationSites(rel, read(rel)));
  assert.deepEqual(
    offenders,
    [],
    'a comment explains why the code is the way it is, in its own words — it should read without the decision index open'
  );
});

test('the detectors flag the substitution damage and only that', () => {
  // The first line of each pair is verbatim damage the sweep left behind.
  const damaged = [
    'UX-only per the architecture decision; list ACLs are the real boundary.',
    'Per The architecture decision, the export is immutable.',
    're-stamps the the architecture decision reporting columns',
    '> [the architecture decision]: ./0023-case-lifecycle.md',
  ].join('\n');
  assert.deepEqual(stockPhraseSites('f', damaged), [
    'f:1',
    'f:2',
    'f:3',
    'f:4',
  ]);
  assert.deepEqual(doubledArticleSites('f', damaged), ['f:3']);

  const clean = [
    'UX-only; SharePoint list ACLs remain the real boundary.',
    're-stamps the corrected-outcome reporting columns',
    'the theme applies to the header',
  ].join('\n');
  assert.deepEqual(stockPhraseSites('f', clean), []);
  assert.deepEqual(doubledArticleSites('f', clean), []);

  assert.deepEqual(adrCitationSites('f', 'See ADR-0011 for design.'), ['f:1']);
  // Case reference numbers and HTML entities are domain values, not citations.
  assert.deepEqual(
    adrCitationSites('f', "reference: 'CASE-42'\nlabel: '&#39;'\n#493 fixture"),
    []
  );
});
