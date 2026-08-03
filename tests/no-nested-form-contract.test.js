// @ts-check

/**
 * No `<form>` element under `src/`.
 *
 * The SharePoint host page wraps the entire page — Content Editor and all — in
 * its own `<form>`. HTML forbids nesting one form inside another, so a `<form>`
 * an app view renders is not a form the browser honours: the parser hoists or
 * drops it, and pressing Enter inside it posts the *host* page back instead of
 * running the view's own handler. The page reloads, the hash route is re-entered
 * from scratch, and any unsaved state in the route slice is gone — a failure
 * that never reproduces in the dev harness, whose host page has no outer form.
 *
 * A view that wants a form's affordances wires them explicitly: a plain
 * container, a `type="button"` button with an `onclick`, and a keydown handler
 * for Enter. That is what the Case search filters do.
 *
 * This is a ratchet, not advice — the failure mode is invisible locally and only
 * shows up once deployed, which is precisely the kind that needs a test rather
 * than a convention.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SRC = new URL('../src/', import.meta.url);

/**
 * @param {URL} dir
 * @returns {URL[]}
 */
function jsFilesUnder(dir) {
  /** @type {URL[]} */
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...jsFilesUnder(new URL(`${entry.name}/`, dir)));
    } else if (entry.name.endsWith('.js')) {
      found.push(new URL(entry.name, dir));
    }
  }
  return found;
}

/**
 * Matches `h('form'`, `h("form"` and `createElement('form'`.
 *
 * Deliberately spans newlines: the formatter breaks a call with several
 * children onto its own lines, so the real offender is spelled `h(\n  'form',`
 * and a line-by-line scan would miss exactly the case this exists to catch.
 */
const FORM_ELEMENT = /(?:\bh|createElement)\(\s*['"]form['"]/g;

test('no view under src/ renders a form element', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const file of jsFilesUnder(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(FORM_ELEMENT)) {
      const line = source.slice(0, match.index).split('\n').length;
      offenders.push(`${file.pathname.split('/src/')[1]}:${line}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'a form nested in the host page posts the host back instead of submitting — ' +
      'use a container plus an explicit button and Enter handler'
  );
});

test('the detector fires on the spellings it is meant to catch', () => {
  for (const spelling of [
    "h('form', { className: 'x' })",
    'h("form")',
    "document.createElement('form')",
    // The formatted spelling, which is how it actually appears in a view.
    "  return h(\n    'form',\n    { className: 'x' },",
  ]) {
    assert.ok(
      new RegExp(FORM_ELEMENT.source).test(spelling),
      `should have matched: ${spelling}`
    );
  }
});

test('the detector ignores the words that merely mention a form', () => {
  for (const innocent of [
    "h('div', { className: 'cora-case-search-filters' })",
    '// the host page wraps everything in a form',
    "h('button', { type: 'button' })",
    'formatDate(value)',
    "h('form-like')",
  ]) {
    assert.equal(
      new RegExp(FORM_ELEMENT.source).test(innocent),
      false,
      `should not have matched: ${innocent}`
    );
  }
});
