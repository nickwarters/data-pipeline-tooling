// @ts-check

/**
 * Layering contract for MAINT-16: the "question bank editor subsystem" under
 * `src/question-bank/` must stay an optional bolt-on, not a dependency the rest
 * of `src/components/` reaches into.
 *
 * Two rules are enforced, at the level actually achieved by MAINT-16:
 *
 *  1. Generic helpers were relocated to `src/lib/` (showWhen-tree manipulation →
 *     `lib/showwhen-tree.js`; question/category ordering → `lib/question-order.js`;
 *     the transient toast primitive → `lib/toast.js`). No component may import
 *     those concerns from `src/question-bank/` any more.
 *
 *  2. The only remaining `src/components/` → `src/question-bank/` couplings are a
 *     small, explicit allowlist of editor primitives that read the bank-editor
 *     *store singleton* (`commit`/`currentBank`/`activeSlug`/`filters` etc.). That
 *     coupling is genuine (not mechanical to inject as props) and is documented in
 *     each file; the allowlist can only shrink, never grow.
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

/** @param {string} rel @returns {boolean} whether the file imports from src/question-bank/ */
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
    'these files must import showWhen-tree/order helpers from src/lib/, not src/question-bank/'
  );
});

test('layering: cora-toast (a base primitive) does not import from question-bank/', () => {
  assert.equal(
    importsQuestionBank('src/components/base/cora-toast.js'),
    false,
    'the base toast reads the transient toast primitive from src/lib/toast.js'
  );
});

test('layering: components→question-bank couplings match the documented allowlist', () => {
  // Editor primitives that still read the bank-editor store singleton. Genuine
  // coupling (documented in each file); this list may shrink but must not grow.
  const ALLOWED = new Set([
    'src/components/base/cora-question-labels.js',
    'src/components/base/cora-showwhen-leaf.js',
    'src/components/sections/cora-question-card.js',
    'src/components/sections/cora-showwhen-editor.js',
    'src/components/sections/cora-showwhen-group.js',
    'src/components/sections/cora-wording-editor.js',
    'src/components/collections/cora-case-tabs.js',
    'src/components/collections/cora-compile-drawer.js',
  ]);

  const actual = componentFiles.filter(importsQuestionBank);
  const unexpected = actual.filter((rel) => !ALLOWED.has(rel));
  assert.deepEqual(
    unexpected,
    [],
    'new component→question-bank coupling: inject the state via props or relocate the helper to src/lib/'
  );

  // The allowlist may only shrink: flag entries that no longer couple so the
  // list is trimmed as decoupling progresses.
  const stale = [...ALLOWED].filter((rel) => !actual.includes(rel));
  assert.deepEqual(
    stale,
    [],
    'these files no longer import from question-bank/ — remove them from ALLOWED'
  );
});
