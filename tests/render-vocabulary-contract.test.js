// @ts-check

/**
 * Render-vocabulary contract.
 *
 * The runtime does two different things and each has exactly one word:
 *
 *  - **`view`** produces a tree of nodes. Pure, returns `Node`s, touches
 *    nothing.
 *  - **`render`** commits a tree into a live container. `src/core/render.js` is
 *    the only thing that does it.
 *
 * That distinction is easy to state and easy to lose: the codebase carried
 * three producers named `render` and a DOM-agnostic store whose callback was
 * also called `render`, which is how a three-`render` call
 * stack appeared in `store-route.js`. These tests are the ratchet.
 *
 * They are deliberately *structural* rather than a list of banned filenames:
 *
 *  1. Nothing imports the old `core/morph.js` module or calls `tools.morph(…)`
 *     — including from `tests/` and `dev/`, so a copied-forward example cannot
 *     quietly reintroduce the old spelling.
 *  2. `createStore` is called with `onStateChange`, never `render`. The store
 *     owns state and scheduling and knows nothing about the DOM; naming its
 *     callback `render` is the mistake that started the overload.
 *
 * Prose is exempt on purpose. `src/core/render.js`'s header names `morph()` to
 * record the former name and the morphdom/Idiomorph lineage the technique is
 * still searchable under, and `docs/` keeps its historical wording — so these
 * tests mask comments out and scan **code only**. String literals are
 * deliberately *not* masked: an `import … from './morph.js'` specifier is a
 * string, and it is the single most important thing to catch.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url);
const SCAN_ROOTS = ['src/', 'tests/', 'dev/'];

/** @param {URL} dir @returns {string[]} repo-relative paths of every JS/HTML file */
function sourceFilesUnder(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) out.push(...sourceFilesUnder(child));
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.html'))
      out.push(child.pathname.slice(ROOT.pathname.length));
  }
  return out;
}

/**
 * Blank out `//` and `/* *\/` comments, keeping every character position (and
 * therefore every line number) intact. Comments are where the historical name
 * is allowed to live, so they must not be scanned.
 *
 * @param {string} source
 * @returns {string} same length as `source`, code only
 */
function maskComments(source) {
  const out = source.split('');
  const blank = (/** @type {number} */ from, /** @type {number} */ to) => {
    for (let i = from; i < to && i < out.length; i++)
      if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  while (i < source.length) {
    if (source[i] === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
    } else if (source[i] === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      blank(i, end === -1 ? source.length : end + 2);
      i = end === -1 ? source.length : end + 2;
    } else {
      i++;
    }
  }
  return out.join('');
}

/**
 * This file is exempt from its own scan: the assertion messages below quote
 * both banned spellings on purpose, so that a developer who trips the contract
 * is told what to write instead. Masking string literals would not do — an
 * `import … from './morph.js'` specifier *is* a string literal, and that is the
 * single most important thing to catch.
 */
const SELF = 'tests/render-vocabulary-contract.test.js';

const FILES = SCAN_ROOTS.filter((dir) => existsSync(new URL(dir, ROOT)))
  .flatMap((dir) => sourceFilesUnder(new URL(dir, ROOT)))
  .filter((file) => file !== SELF);

test('render vocabulary: the module is core/render.js, and core/morph.js is gone', () => {
  assert.ok(
    existsSync(new URL('src/core/render.js', ROOT)),
    'src/core/render.js must exist — it is the one thing that commits a tree'
  );
  assert.ok(
    !existsSync(new URL('src/core/morph.js', ROOT)),
    'src/core/morph.js was renamed to render.js'
  );
});

test('render vocabulary: nothing imports core/morph.js or calls tools.morph()', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const file of FILES) {
    const code = maskComments(readFileSync(new URL(file, ROOT), 'utf8'));
    code.split('\n').forEach((line, index) => {
      if (/core\/morph\.js/.test(line) || /\bmorph\s*\(/.test(line)) {
        offenders.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    'commit a tree with render(container, tree) / tools.render(…), ' +
      'not morph(). Found:\n' +
      offenders.join('\n')
  );
});

test('render vocabulary: createStore is given onStateChange, never render', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const file of FILES) {
    const code = maskComments(readFileSync(new URL(file, ROOT), 'utf8'));
    // The store's option bag, wherever it is built: `createStore({ … })` spans
    // lines, so scan from each call to its closing brace.
    let from = 0;
    for (;;) {
      const at = code.indexOf('createStore(', from);
      if (at === -1) break;
      const end = code.indexOf('})', at);
      const bag = code.slice(at, end === -1 ? code.length : end);
      if (/(^|[{,\s])render\s*:/.test(bag)) {
        offenders.push(`${file}: createStore({ render: … })`);
      }
      from = at + 'createStore('.length;
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'the store is DOM-agnostic — its callback is onStateChange. ' +
      'Found:\n' +
      offenders.join('\n')
  );
});

test('render vocabulary: the store exposes onStateChange and flush, not render', async () => {
  const { createStore } = await import('../src/core/store.js');
  /** @type {number[]} */
  const seen = [];
  const store = createStore({
    initialState: { n: 0 },
    reducer: (
      /** @type {{n: number}} */ state,
      /** @type {{type: string}} */ action
    ) => (action.type === 'inc' ? { n: state.n + 1 } : state),
    onStateChange: (/** @type {{n: number}} */ state) => seen.push(state.n),
    schedule: (/** @type {() => void} */ callback) => callback(),
  });

  assert.equal(
    typeof (/** @type {any} */ (store).render),
    'undefined',
    'store.render() was renamed to store.flush()'
  );
  store.flush();
  store.dispatch({ type: 'inc' });
  assert.deepEqual(
    seen,
    [0, 1],
    'flush and dispatch both notify onStateChange'
  );
});
