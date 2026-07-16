// @ts-check

/**
 * Layering contract (MAINT-16, completed by the store inversion in #382): the
 * question bank editor subsystem must stay an optional bolt-on, not a
 * dependency anything under `src/components/` reaches into.
 *
 * Two rules are enforced:
 *
 *  1. Generic helpers were relocated to `src/lib/` (showWhen-tree manipulation →
 *     `lib/showwhen-tree.js`; question/category ordering → `lib/question-order.js`;
 *     the transient toast primitive → `lib/toast.js`). No component may import
 *     those concerns from the question-bank subsystem any more.
 *
 *  2. No component imports from the question-bank subsystem at all. The last
 *     ten couplings (editor primitives reading the bank-editor *store
 *     singleton*) were inverted in issue #382: state flows down as properties
 *     (signals allowed as property values) and mutations flow up through
 *     `onCommit` callbacks, with the bank editor page owning the only store
 *     imports.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url);
const COMPONENTS = new URL('src/components/', ROOT);

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

/** @param {string} rel @returns {boolean} whether the file imports from src/pages/question-bank/ */
function importsQuestionBank(rel) {
  const src = readFileSync(new URL(rel, ROOT), 'utf8');
  return /from\s+['"][^'"]*question-bank\//.test(src);
}

const componentFiles = jsFilesUnder(COMPONENTS);

test('layering: no component imports the relocated generic helpers from question-bank/', () => {
  const offenders = componentFiles.filter((rel) => {
    const src = readFileSync(new URL(rel, ROOT), 'utf8');
    return /question-bank\/question-bank-(tree|order)\.js/.test(src);
  });
  assert.deepEqual(
    offenders,
    [],
    'these files must import showWhen-tree/order helpers from src/lib/, not src/pages/question-bank/'
  );
});

test('layering: cora-toast (a base primitive) does not import from question-bank/', () => {
  assert.equal(
    importsQuestionBank('src/components/base/cora-toast.js'),
    false,
    'the base toast reads the transient toast primitive from src/lib/toast.js'
  );
});

test('layering: no component imports from the question-bank subsystem', () => {
  // The last ten couplings (editor primitives reading the bank-editor store
  // singleton) were inverted in issue #382: state flows down as properties
  // (signals allowed as property values) and mutations flow up through
  // `onCommit` callbacks; the bank editor page owns the only store imports.
  const offenders = componentFiles.filter(importsQuestionBank);
  assert.deepEqual(
    offenders,
    [],
    'components must receive question-bank state via props and report mutations via onCommit — see issue #382 and docs/question-bank-store-inversion-explainer.html'
  );
});
