// @ts-check

/**
 * `cora-*` element-type contract (#536).
 *
 * The `cora-` prefix is the SharePoint isolation boundary (ADR-0001, ADR-0029)
 * — but since ADR-0034 it is a *CSS namespace*, not an element registry. No
 * `cora-*` custom element is registered any more (#514 removed the last
 * unregistered hosts), so an element-type selector like `cora-app-nav { … }`
 * matches nothing and silently drops every declaration in it. That is exactly
 * how the nav bar lost its sticky positioning, surface background and bottom
 * border, and how the People Picker's absolutely positioned dropdown lost its
 * containing block: rules that read as live styling but matched nothing. Run
 * against the pre-fix stylesheet, the detector below finds seven such selectors
 * — the three #536 names, plus four `cora-notes > …` rules nobody had noticed.
 * That is the argument for a ratchet rather than three edits.
 *
 * Two halves, one rule — style `cora-*` by class, never by element type:
 *
 *  1. No `createElement('cora-…')` / `h('cora-…')` under `src/`. `h()` warns at
 *     runtime for an unregistered `cora-*` tag (see `warnIfUnregisteredCoraElement`
 *     in `src/lib/html.js`); this makes it a build-time failure instead.
 *  2. No element-type `cora-*` selector in `src/styles/**.css`.
 *
 * Rule 2 is deliberately narrow, because a sloppy regex here would be worse
 * than no test at all. It fires only on a bare `cora-foo` in *type* position
 * inside a selector list. It must not fire on `.cora-foo` class selectors, on
 * `[data-cora-root]` or any other attribute selector mentioning `cora-`, or on
 * `--cora-*` custom properties — all three are the normal, correct spelling and
 * appear hundreds of times. The synthetic fixture at the bottom pins all of
 * those cases, including the real pre-fix rules this contract was written
 * against.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url);

/**
 * @param {URL} dir @param {string} ext
 * @returns {string[]} repo-relative paths of every file with that extension
 */
function filesUnder(dir, ext) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) out.push(...filesUnder(child, ext));
    else if (entry.name.endsWith(ext))
      out.push(child.pathname.slice(ROOT.pathname.length));
  }
  return out;
}

/**
 * Source with whole-line comments removed, so the `h('cora-x', ...)` named in
 * `src/lib/html.js`'s own explanatory JSDoc is not read as a call site.
 * @param {string} source @returns {string}
 */
function stripCommentLines(source) {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');
}

/**
 * Every place a `cora-*` element would actually be constructed: a string
 * literal tag handed to `document.createElement()` or to `h()`.
 *
 * @param {string} rel @param {string} source
 * @returns {string[]} `path:line` for each construction site
 */
export function coraElementConstructions(rel, source) {
  const code = stripCommentLines(source);
  /** @type {string[]} */
  const found = [];
  for (const match of code.matchAll(
    /(?:\bcreateElement|\bh)\(\s*['"`](cora-[\w-]*)/g
  )) {
    const line = code.slice(0, match.index ?? 0).split('\n').length;
    found.push(`${rel}:${line} → ${match[1]}`);
  }
  return found;
}

/**
 * Every element-type `cora-*` selector in a stylesheet.
 *
 * Works on selector lists only — the text preceding a `{` — so declaration
 * values (`var(--cora-space-2)`) are never examined. Within a selector list,
 * attribute selectors are blanked first (`[data-cora-root]`), then a `cora-`
 * identifier counts as a type selector only when the character before it is not
 * one that would make it part of another token: `.` (class), `#` (id), `:`
 * (pseudo), `-` (custom property / longer identifier), or a word character.
 *
 * @param {string} rel @param {string} css
 * @returns {string[]} `path:line → selector` for each offending selector list
 */
export function elementTypeCoraSelectors(rel, css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, ' ')
  );
  /** @type {string[]} */
  const found = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < withoutComments.length; i++) {
    const c = withoutComments[i];
    if (c === '{') {
      const prelude = withoutComments.slice(start, i);
      // Only rule preludes are selector lists; `@media (...)`, `@supports`,
      // `@font-face` and friends are not, and neither is anything nested inside
      // a declaration block.
      if (depth === 0 || isNestedRuleContext(withoutComments, start)) {
        if (!/^\s*@/.test(prelude) && hasTypeCoraSelector(prelude)) {
          const line = withoutComments.slice(0, start).split('\n').length;
          found.push(`${rel}:${line} → ${prelude.trim().replace(/\s+/g, ' ')}`);
        }
      }
      depth++;
      start = i + 1;
    } else if (c === '}') {
      depth--;
      start = i + 1;
    } else if (c === ';' && depth === 0) {
      start = i + 1;
    }
  }
  return found;
}

/**
 * A rule nested one level inside an at-rule block (`@media { .x { … } }`) is
 * still a selector list. A block nested inside an ordinary rule is not — CSS
 * nesting is not used in this repo, so anything at depth ≥ 1 that is not inside
 * an at-rule is treated as declarations and skipped.
 * @param {string} css @param {number} start index the prelude begins at
 * @returns {boolean}
 */
function isNestedRuleContext(css, start) {
  const before = css.slice(0, start);
  const openAtRule = before.lastIndexOf('@');
  if (openAtRule === -1) return false;
  // Inside the most recent at-rule block only if it has not been closed yet.
  let depth = 0;
  for (const c of before.slice(openAtRule)) {
    if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  return depth === 1;
}

/** @param {string} selectorList @returns {boolean} */
function hasTypeCoraSelector(selectorList) {
  const blanked = selectorList
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:[^()]|\([^()]*\))*\)/g, ' ');
  return /(^|[^\w.#:-])cora-/.test(blanked);
}

const srcJs = filesUnder(new URL('src/', ROOT), '.js');
const srcCss = filesUnder(new URL('src/', ROOT), '.css');

test('the cora-element scan covers src/ JavaScript and stylesheets', () => {
  assert.ok(
    srcJs.length > 50,
    'expected the JS scan to cover the whole of src/'
  );
  assert.ok(
    srcCss.some((rel) => rel.endsWith('cora-styles.css')),
    'expected the CSS scan to reach the main stylesheet'
  );
  // A detector that never matched anything would make both rules vacuous; the
  // synthetic fixtures at the bottom are what prove it still fires.
});

test('no cora-* element is constructed under src/', () => {
  const offenders = srcJs.flatMap((rel) =>
    coraElementConstructions(rel, readFileSync(new URL(rel, ROOT), 'utf8'))
  );
  assert.deepEqual(
    offenders,
    [],
    'the `cora-` prefix is a CSS namespace, not an element registry (ADR-0034) — render a plain element with a `cora-…` className instead'
  );
});

test('no element-type cora-* selector in src/styles/', () => {
  const offenders = srcCss.flatMap((rel) =>
    elementTypeCoraSelectors(rel, readFileSync(new URL(rel, ROOT), 'utf8'))
  );
  assert.deepEqual(
    offenders,
    [],
    'nothing creates `cora-*` elements, so an element-type selector matches nothing and silently drops its declarations — select the class instead (#536)'
  );
});

test('the CSS detector flags element-type selectors and only those', () => {
  // The first three are verbatim the rules #536 removed; everything after is
  // the spelling that must keep passing.
  const fixture = `
    [data-cora-root] cora-app-nav { display: block; z-index: 100; }
    cora-people-picker { position: relative; }
    cora-tabs { display: block; }
    .cora-app-nav-bar { position: sticky; top: 0; }
    [data-cora-root] .cora-page-content { max-width: 60rem; }
    [data-cora-root] { color: var(--cora-color-on-surface); }
    :root { --cora-space-2: 0.5rem; --cora-z-app-root: 2147483000; }
    a[href^='#/cora-thing'] { color: inherit; }
    .cora-tabs-tab[aria-selected='true'] { font-weight: 700; }
    .cora-x:hover, .cora-y:focus-visible { outline: none; }
    div.cora-z > .cora-w + .cora-v ~ .cora-u { gap: 0; }
    /* cora-comment-mention { display: none; } */
    @media (min-width: 40rem) { .cora-kpi-strip { display: grid; } }
    @media print { cora-toast { display: none; } }
    @supports (scrollbar-gutter: stable) { .cora-a { scrollbar-gutter: stable; } }
  `;
  assert.deepEqual(
    elementTypeCoraSelectors('fixture.css', fixture).map((f) =>
      f.replace(/^fixture\.css:\d+ → /, '')
    ),
    [
      '[data-cora-root] cora-app-nav',
      'cora-people-picker',
      'cora-tabs',
      'cora-toast',
    ],
    'the detector must fire on a bare cora-* in type position — including inside an at-rule block — and on nothing else'
  );
});

test('the JS detector flags a constructed cora-* element, not a mention of one', () => {
  const fixture = `
    /**
     * Rendering \`h('cora-x', ...)\` without its module warns.
     */
    import { h } from '../lib/html.js';
    export const Bad = () => h('cora-panel', { className: 'cora-panel' });
    export const AlsoBad = () => document.createElement("cora-host");
    export const Good = () => h('div', { className: 'cora-panel' });
    export const Fine = (tag) => document.createElement(tag);
    export const Named = () => h('section', { id: 'cora-panel' });
  `;
  assert.deepEqual(
    coraElementConstructions('fixture.js', fixture).map((f) =>
      f.replace(/^fixture\.js:\d+ → /, '')
    ),
    ['cora-panel', 'cora-host'],
    'only literal `cora-…` tags handed to h()/createElement() are element constructions'
  );
});
