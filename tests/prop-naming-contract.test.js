// @ts-check

/**
 * Prop-naming contract (#509).
 *
 * `h()`'s `applyProp`/`removeProp` treat `on…` keys two different ways by
 * design (see `src/lib/html.js`): a camelCase `on[A-Z]` key that matches a
 * property the element declares is assigned as a *property*, and never becomes
 * a listener. That branch is the props-down/callbacks-up component contract
 * from #382 — but it means `onClick` and `onclick` are not interchangeable on a
 * `cora-*` host that happens to declare `onClick`.
 *
 * So the casing carries meaning, and these tests keep it honest:
 *
 *  1. Anything the browser dispatches is written lowercase (`onclick`,
 *     `oninput`, `onchange`, `onkeydown`, …) so it always reaches
 *     `addEventListener`.
 *  2. camelCase `on[A-Z]` is reserved for component callback properties
 *     (`onAnswer`, `onSort`, `onCommit`, …).
 *  3. The class prop is written `className`, not `class` — both work, so the
 *     point is one spelling, not two.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url);
const SCAN_ROOTS = ['src/', 'case-types/'];

/** DOM events written as `on<Event>` props anywhere in the codebase. */
const DOM_EVENTS = [
  'click',
  'input',
  'change',
  'keydown',
  'keyup',
  'submit',
  'focus',
  'blur',
];

/**
 * The two component callback props that happen to be *named* after a DOM event.
 * Neither is ever handed to `h()` as an element prop — both are keys in a prop
 * object passed to a plain view function, which reads them as
 * `props.onInput` / `props.onSubmit` — so `applyProp` never sees them and the
 * lowercase rule does not apply. They are listed here explicitly rather than
 * pattern-matched, because a textual scan cannot tell a component prop bag from
 * an element prop bag, and an unbounded exemption would give the rule away.
 *
 * (`Tabs`'s `onKeydown` prop in `src/components/base/cora-tabs.js` is a third
 * of the same kind; it currently appears only in JSDoc, which the scan strips.)
 *
 * Renaming these to something that cannot be mistaken for a DOM event —
 * `onQueryInput`, `onPublish` — would remove the need for the list, but that
 * changes a component's public API and is out of scope for #509.
 * @type {ReadonlySet<string>}
 */
const COMPONENT_CALLBACKS_NAMED_AFTER_DOM_EVENTS = new Set([
  // -> AttributeMenu({ onInput })     src/components/sections/cora-attribute-menu.js
  'src/pages/cora-case-review/remediation-view.js → onInput:',
  // -> CompileDrawer({ onSubmit })    src/pages/question-bank/compile-drawer.js
  'src/pages/question-bank/cora-bank-editor.js → onSubmit:',
]);

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
 * Source with whole-line comments removed, so the contract comment in
 * `html.js` and prose that mentions `class:` or `onClick:` do not trip the
 * scan. Only real code remains.
 * @param {string} rel @returns {string[]} code lines, 1-indexed positions kept
 */
function codeLines(rel) {
  return readFileSync(new URL(rel, ROOT), 'utf8')
    .split('\n')
    .map((line) => (/^\s*(\*|\/\/|\/\*)/.test(line) ? '' : line));
}

const productionFiles = SCAN_ROOTS.flatMap((dir) =>
  jsFilesUnder(new URL(dir, ROOT))
);

test('production files are in scope for the prop-naming scan', () => {
  assert.ok(
    productionFiles.length > 50,
    `expected the scan to cover the whole of ${SCAN_ROOTS.join(' and ')}`
  );
});

test('DOM event props are written lowercase', () => {
  /** @type {string[]} */
  const offenders = [];
  // Any `onSomething:` prop key. Anything whose event name is a DOM event but
  // is not spelled all-lowercase (`onClick`, `onKeydown`, `onKEYUP`) is
  // ambiguous at the applyProp branch and therefore an offender.
  const propKey = /\bon([A-Za-z]+)\s*:/g;
  for (const rel of productionFiles) {
    codeLines(rel).forEach((line, index) => {
      for (const [, name] of line.matchAll(propKey)) {
        if (!DOM_EVENTS.includes(name.toLowerCase())) continue;
        if (name === name.toLowerCase()) continue;
        if (
          COMPONENT_CALLBACKS_NAMED_AFTER_DOM_EVENTS.has(`${rel} → on${name}:`)
        )
          continue;
        offenders.push(`${rel}:${index + 1} → on${name}:`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    'DOM event props must be lowercase (onclick, oninput, onchange, onkeydown, …) so they reach addEventListener; camelCase on[A-Z] is reserved for component callback properties'
  );
});

test('the class prop is written className', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const rel of productionFiles) {
    codeLines(rel).forEach((line, index) => {
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
