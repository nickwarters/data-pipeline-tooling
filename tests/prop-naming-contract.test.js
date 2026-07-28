// @ts-check

/**
 * Prop-naming contract.
 *
 * `h()`'s `applyProp`/`removeProp` treat `on…` keys two different ways by
 * design (see `src/lib/html.js`): a camelCase `on[A-Z]` key that matches a
 * property the element declares is assigned as a *property*, and never becomes
 * a listener. That branch is the props-down/callbacks-up component contract
 * — but it means `onClick` and `onclick` are not interchangeable on a
 * `cora-*` host that happens to declare `onClick`.
 *
 * So the casing carries meaning, and these tests keep it honest:
 *
 *  1. Anything handed to `h()` as an element prop is written lowercase
 *     (`onclick`, `oninput`, `onpointerdown`, …) so it always reaches
 *     `addEventListener`.
 *  2. camelCase `on[A-Z]` is reserved for component callback properties
 *     (`onAnswer`, `onSort`, `onCommit`, …), which are read off a plain prop
 *     object by a view function and never reach `applyProp`.
 *  3. The class prop is written `className`, not `class` — both work, so the
 *     point is one spelling, not two.
 *
 * The rule is enforced **structurally, not against a list of event names**: an
 * `on…` prop key is judged by the call it sits in, so a handler for an event
 * nobody has written yet (`onpointerdown`, `onpaste`, `onscroll`) is covered
 * the day it is written. An earlier draft of this file matched eight
 * hard-coded event names, which let `onMouseEnter:` inside an `h()` call pass
 * clean — precisely the footgun this file exists to close.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url);
const SCAN_ROOTS = ['src/', 'case-types/'];

/** @param {URL} dir @returns {string[]} repo-relative paths of every .js file */
function jsFilesUnder(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) out.push(...jsFilesUnder(child));
    else if (entry.name.endsWith('.js'))
      out.push(child.pathname.slice(ROOT.pathname.length));
  }
  return out;
}

/**
 * Blank out comments, strings, template literals and regex literals, keeping
 * every character position (and therefore every line number) intact. Brackets
 * inside prose or string data would otherwise derail the bracket walk below,
 * and the `html.js` contract comment names both spellings on purpose.
 *
 * @param {string} source
 * @returns {string} same length as `source`, code structure only
 */
function maskNonCode(source) {
  const out = source.split('');
  const blank = (/** @type {number} */ from, /** @type {number} */ to) => {
    for (let i = from; i < to && i < out.length; i++)
      if (out[i] !== '\n') out[i] = ' ';
  };
  // A `/` starts a regex (not a division) when the last meaningful character
  // opens an expression position. Good enough for this codebase, and the
  // balance assertion below catches it if it ever is not.
  const REGEX_PRECEDERS = '(,=:[!&|?{};+-*%<>~^';
  let i = 0;
  let lastCode = '';
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      blank(i, end === -1 ? source.length : end + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== c)
        j += source[j] === '\\' ? 2 : 1;
      blank(i, j + 1);
      i = j + 1;
      lastCode = 'x';
    } else if (c === '`') {
      // Blank the whole template, expressions included: `${…}` braces vanish
      // wholesale, so bracket balance is preserved either way.
      let j = i + 1;
      let depth = 0;
      while (j < source.length) {
        if (source[j] === '\\') j += 2;
        else if (source[j] === '`' && depth === 0) break;
        else {
          if (source[j] === '{' && source[j - 1] === '$') depth++;
          else if (source[j] === '}' && depth > 0) depth--;
          j++;
        }
      }
      blank(i, j + 1);
      i = j + 1;
      lastCode = 'x';
    } else if (c === '/' && REGEX_PRECEDERS.includes(lastCode)) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length) {
        if (source[j] === '\\') j += 2;
        else if (source[j] === '[') ((inClass = true), j++);
        else if (source[j] === ']') ((inClass = false), j++);
        else if (source[j] === '/' && !inClass) break;
        else if (source[j] === '\n') break;
        else j++;
      }
      blank(i, j + 1);
      i = j + 1;
      lastCode = 'x';
    } else {
      if (!/\s/.test(c)) lastCode = c;
      i++;
    }
  }
  return out.join('');
}

/**
 * Index of the nearest bracket that is still open at `from`, walking backwards.
 * @param {string} masked @param {number} from @returns {number} index, or -1
 */
function enclosingOpener(masked, from) {
  let depth = 0;
  for (let i = from - 1; i >= 0; i--) {
    const c = masked[i];
    if (c === '}' || c === ')' || c === ']') depth++;
    else if (c === '{' || c === '(' || c === '[') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/**
 * The function an object literal is being passed to, or null when the literal
 * is not a call argument. `h('button', { onclick })` → `'h'`.
 *
 * @param {string} masked @param {number} braceIndex @returns {string | null}
 */
function calleeOfObjectLiteral(masked, braceIndex) {
  const parenIndex = enclosingOpener(masked, braceIndex);
  if (parenIndex === -1 || masked[parenIndex] !== '(') return null;
  return (
    masked.slice(0, parenIndex).match(/([A-Za-z_$][\w$]*)\s*$/)?.[1] ?? null
  );
}

/**
 * Every `on…:` prop key in a source file, tagged with whether it is being
 * handed straight to `h()` (an element prop, so `applyProp` sees it) or to a
 * view function (a component callback, which `applyProp` never sees).
 *
 * @param {string} rel @param {string} source
 * @returns {{ where: string, name: string, inH: boolean }[]}
 */
export function propKeys(rel, source) {
  const masked = maskNonCode(source);
  /** @type {{ where: string, name: string, inH: boolean }[]} */
  const found = [];
  for (const match of masked.matchAll(/\bon([A-Za-z]\w*)\s*:/g)) {
    const at = match.index ?? 0;
    const braceIndex = enclosingOpener(masked, at);
    const inObject = braceIndex !== -1 && masked[braceIndex] === '{';
    found.push({
      where: `${rel}:${masked.slice(0, at).split('\n').length}`,
      name: match[1],
      inH: inObject && calleeOfObjectLiteral(masked, braceIndex) === 'h',
    });
  }
  return found;
}

const productionFiles = SCAN_ROOTS.flatMap((dir) =>
  jsFilesUnder(new URL(dir, ROOT))
);

/** @type {{ rel: string, source: string, masked: string }[]} */
const sources = productionFiles.map((rel) => {
  const source = readFileSync(new URL(rel, ROOT), 'utf8');
  return { rel, source, masked: maskNonCode(source) };
});

const allPropKeys = sources.flatMap(({ rel, source }) => propKeys(rel, source));

test('production files are in scope for the prop-naming scan', () => {
  assert.ok(
    productionFiles.length > 50,
    `expected the scan to cover the whole of ${SCAN_ROOTS.join(' and ')}`
  );
  // A masker that silently ate the source would make every rule below vacuous.
  assert.ok(
    allPropKeys.filter((prop) => prop.inH).length > 50,
    'expected to find element props inside h() calls — the scan is not working'
  );
});

test('the code masker keeps bracket structure intact', () => {
  /** @type {string[]} */
  const unbalanced = [];
  for (const { rel, masked } of sources) {
    let depth = 0;
    for (const c of masked) {
      if ('({['.includes(c)) depth++;
      else if (')}]'.includes(c)) depth--;
      if (depth < 0) break;
    }
    if (depth !== 0) unbalanced.push(`${rel} (depth ${depth})`);
  }
  assert.deepEqual(
    unbalanced,
    [],
    'brackets do not balance after masking, so the enclosing-call walk below cannot be trusted'
  );
});

test('element event props handed to h() are lowercase', () => {
  const offenders = allPropKeys
    .filter((prop) => prop.inH && prop.name !== prop.name.toLowerCase())
    .map((prop) => `${prop.where} → on${prop.name}:`);
  assert.deepEqual(
    offenders,
    [],
    'an `on[A-Z]` key passed to h() is assigned as a property when the element declares it, and then no listener is ever attached — write DOM events lowercase (onclick, oninput, onpointerdown, …)'
  );
});

test('camelCase on[A-Z] props are component callbacks, never element props', () => {
  // The mirror of the rule above, stated from the other side: this is what
  // makes the casing a *signal*. Every camelCase handler must be a key in a
  // prop bag read by a view function, never something applyProp will see.
  const offenders = allPropKeys
    .filter((prop) => /^[A-Z]/.test(prop.name) && prop.inH)
    .map((prop) => `${prop.where} → on${prop.name}:`);
  assert.deepEqual(
    offenders,
    [],
    'camelCase on[A-Z] is reserved for the props-down/callbacks-up component API'
  );
});

test('the class prop is written className', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const { rel, masked } of sources) {
    masked.split('\n').forEach((line, index) => {
      if (/(^|[^.\w])class\s*:/.test(line))
        offenders.push(`${rel}:${index + 1}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    'use className: in h() props — `class:` works but two spellings for one prop is the thing this contract removes'
  );
});

test('the scan flags a camelCase handler for any event, not a fixed list', () => {
  // The regression that motivated the structural rewrite: the previous version
  // of this contract matched eight hard-coded event names, so these passed.
  const source = `
    import { h } from '../lib/html.js';
    export const Panel = (props) =>
      h('div', { className: 'p', onMouseEnter: () => {}, onPaste: () => {} },
        AttributeMenu({ onInput: props.onQuery, onSubmit: props.onGo }));
  `;
  const found = propKeys('synthetic.js', source);
  assert.deepEqual(
    found.filter((prop) => prop.inH).map((prop) => `on${prop.name}`),
    ['onMouseEnter', 'onPaste'],
    'element props inside h() must be detected whatever the event is named'
  );
  assert.deepEqual(
    found.filter((prop) => !prop.inH).map((prop) => `on${prop.name}`),
    ['onInput', 'onSubmit'],
    'component callbacks named after DOM events are exempt by structure, not by an allowlist'
  );
});
