// @ts-check
//
// Issue #268 — the framework, embedded via a Content Editor Web Part, must
// break out of SharePoint's content well to cover the full viewport, and must
// reset SharePoint SE's inherited styling within our light-DOM subtree. These
// are pure CSS concerns, so (like framework-contract.test.js) we assert against
// the stylesheet source rather than a live browser.

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url);

/** @param {string} path */
function read(path) {
  return readFileSync(new URL(path, ROOT), 'utf8');
}

const styles = read('src/styles/cora-styles.css');
const questionBankStyles = read(
  'src/question-bank/cora-question-bank-editor.css'
);
const tokens = read('src/styles/cora-design-tokens.css');

/**
 * Extract the declaration block for the first rule whose selector list matches
 * `selector` exactly (verbatim, whitespace-insensitive around the brace).
 * @param {string} css
 * @param {string} selector
 * @returns {string}
 */
function ruleBody(css, selector) {
  const idx = css.indexOf(selector);
  assert.notEqual(idx, -1, `expected a rule for \`${selector}\``);
  const open = css.indexOf('{', idx);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

test('breakout: #app is promoted to a fixed full-viewport layer', () => {
  const body = ruleBody(styles, '#app[data-cora-root] {');
  assert.match(
    body,
    /position:\s*fixed/,
    'root must be fixed to escape the CEWP content well'
  );
  assert.match(body, /inset:\s*0/, 'inset:0 makes the layer fill the viewport');
  assert.match(
    body,
    /z-index:\s*var\(--cora-z-app-root\)/,
    'the layer must carry the app-root z-index so it sits over SP chrome'
  );
});

test('breakout: the app root owns vertical scroll and clips horizontal overflow', () => {
  const body = ruleBody(styles, '#app[data-cora-root] {');
  assert.match(
    body,
    /overflow-y:\s*auto/,
    'the app container owns the vertical scroll'
  );
  assert.match(body, /overflow-x:\s*hidden/, 'no horizontal page scroll');
});

test('breakout: the app-root z-index token exists and is high enough to cover SP chrome', () => {
  const match = tokens.match(/--cora-z-app-root:\s*(\d+)/);
  assert.ok(match, '--cora-z-app-root must be defined in the design tokens');
  assert.ok(
    Number(match[1]) >= 1_000_000,
    'the breakout must out-stack SharePoint SE chrome'
  );
});

test('breakout: fixed positioning is scoped to #app, not every [data-cora-root]', () => {
  // The generic layout-shell rule must stay in normal flow so inline scoping
  // wrappers (styleguide demos, nested previews) are not turned into overlays.
  const shell = ruleBody(styles, '[data-cora-root] {');
  assert.doesNotMatch(
    shell,
    /position:\s*fixed/,
    'the bare [data-cora-root] shell must not be fixed-positioned'
  );
});

test("reset: form controls inherit our typography rather than SharePoint's UI font", () => {
  const body = ruleBody(
    styles,
    '[data-cora-root] :where(input, select, textarea, button, optgroup) {'
  );
  assert.match(body, /font-family:\s*inherit/);
  assert.match(body, /font-size:\s*inherit/);
  assert.match(body, /color:\s*inherit/);
});

test('reset: links are repainted in our accent colour, not SharePoint blue', () => {
  const body = ruleBody(styles, '[data-cora-root] :where(a:link, a:visited) {');
  assert.match(body, /color:\s*var\(--cora-color-accent\)/);
  assert.match(body, /text-decoration:\s*none/);
});

test('reset: H2 headings keep the CORA surface colour over SharePoint theme styles', () => {
  const body = ruleBody(styles, '[data-cora-root] h2 {');
  assert.match(
    body,
    /color:\s*var\(--cora-color-on-surface\)\s*!important/,
    'the concrete heading colour must win over SharePoint direct heading rules'
  );
});

test('Question Bank: field selects use the theme surface rather than a native white fill', () => {
  const body = ruleBody(
    questionBankStyles,
    '}\ncora-bank-editor .field-select {'
  );
  assert.match(body, /background-color:\s*var\(--cora-color-surface\)/);
});

test('reset: tables collapse their borders, neutralising SP core table styling', () => {
  const body = ruleBody(styles, '[data-cora-root] :where(table) {');
  assert.match(body, /border-collapse:\s*collapse/);
});

test('reset: leaked properties are re-established without a blanket !important', () => {
  // The reset should establish a baseline the cascade respects, reaching for
  // !important only where SP genuinely can't be out-specified — none of that
  // yet, so guard against a regression toward !important-spam in the reset.
  const from = styles.lastIndexOf(
    '/*',
    styles.indexOf('Scoped SharePoint SE reset')
  );
  const resetSection = styles
    .slice(from, styles.indexOf('Reduced-motion'))
    .replace(/\/\*[\s\S]*?\*\//g, ''); // drop comments; we only care about declarations
  assert.ok(from !== -1, 'reset section must be present');
  assert.doesNotMatch(resetSection, /!important/);
});
