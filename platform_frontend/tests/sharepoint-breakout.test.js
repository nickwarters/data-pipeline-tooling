// @ts-check
//
// The framework, embedded via a Content Editor Web Part, must
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
  'src/pages/question-bank/cora-question-bank-editor.css'
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

test('People Picker status: the reserved line has a token fallback before lh', () => {
  const selector = '.cora-people-picker-status {';
  const body = ruleBody(styles, selector);
  const minHeightDeclarations = body.match(/min-height\s*:/g) ?? [];

  assert.equal(
    minHeightDeclarations.length,
    2,
    'status reservation must have exactly a fallback and an lh declaration'
  );
  assert.match(
    body,
    /min-height:\s*calc\(var\(--cora-font-size-sm\) \* var\(--cora-line-height-base\)\);\s*min-height:\s*1lh;/
  );
});

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

test('breakout: the nav clearance is measured from the nav bar itself', () => {
  // Everything that parks against this scroller's top edge measures from one
  // token, so the two facts it encodes are worth pinning: the nav bar is sticky
  // at top: 0 *inside* the scroller, and it is --cora-nav-height tall.
  const nav = ruleBody(styles, '[data-cora-root] .cora-app-nav-bar {');
  assert.match(nav, /position:\s*sticky/);
  assert.match(nav, /top:\s*0/);
  assert.match(
    nav,
    /height:\s*var\(--cora-nav-height\)/,
    'the clearance must be measured from the nav bar\u2019s own height'
  );
  assert.match(
    tokens,
    /--cora-nav-clearance:\s*calc\(var\(--cora-nav-height\)[^;]*\)/,
    '--cora-nav-clearance must derive from the nav height, not restate it'
  );
});

test('breakout: scrolled-to content clears the sticky nav bar', () => {
  // Without scroll-padding-top every scrollIntoView({ block: 'start' }) — "Jump
  // to next unanswered", the Question Group jumps — parks its target's top edge
  // behind the nav bar and hides the question wording.
  const body = ruleBody(styles, '#app[data-cora-root] {');
  assert.match(
    body,
    /scroll-padding-top:\s*var\(--cora-nav-clearance\)/,
    'the scroller must reserve room for its own sticky header'
  );
});

test('breakout: the Question Group rail sticks below the nav, not behind it', () => {
  // The rail shares the scroller with the nav bar, which paints over it, so it
  // must come to rest at the nav's lower edge — otherwise it (and the "Jump to
  // next unanswered" button it carries) slides behind the nav while scrolling.
  const rail = ruleBody(styles, '[data-cora-root] .cora-group-progress {');
  assert.match(rail, /position:\s*sticky/);
  assert.match(
    rail,
    /top:\s*var\(--cora-nav-clearance\)/,
    'the sticky rail must rest below the nav bar'
  );
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

test('reset: headings keep their CORA colours over SharePoint theme styles', () => {
  for (const heading of ['h1', 'h2', 'h3']) {
    const body = ruleBody(styles, `[data-cora-root] ${heading} {`);
    assert.match(
      body,
      /color:\s*var\(--cora-color-on-surface\)\s*!important/,
      `${heading} must use the concrete CORA surface colour`
    );
  }

  const h5AndH6 = ruleBody(
    styles,
    '[data-cora-root] h5,\n[data-cora-root] h6 {'
  );
  assert.match(
    h5AndH6,
    /color:\s*var\(--cora-color-on-surface\)\s*!important/,
    'H5 and H6 must use the concrete CORA surface colour'
  );

  const h4 = ruleBody(styles, '[data-cora-root] h4 {');
  assert.match(h4, /color:\s*var\(--cora-color-text-muted\)/);
  assert.doesNotMatch(
    h4,
    /color:\s*var\(--cora-color-text-muted\)\s*!important/
  );
});

test('Question Bank: intentional muted headings keep their colours over the base heading rules', () => {
  for (const selector of [
    '.cora-bank-editor .rail-section h3 {',
    '.cora-bank-editor .outcome-options h3 {',
    '.cora-bank-editor .empty h3 {',
    '.cora-bank-editor .rem-outcome-block h5 {',
  ]) {
    const body = ruleBody(questionBankStyles, selector);
    assert.match(
      body,
      /color:\s*var\(--cora-color-text-muted\)\s*!important/,
      `${selector} must retain its muted colour over the base heading rule`
    );
  }
});

test('Question Bank: other heading colours remain on the CORA surface token', () => {
  for (const selector of [
    '.cora-bank-editor h1 {',
    '.cora-bank-editor .editor-head h2 {',
    '.cora-bank-editor .drawer-head h3 {',
  ]) {
    const body = ruleBody(questionBankStyles, selector);
    assert.match(body, /color:\s*var\(--cora-color-on-surface\)/);
  }
});

test('Question Bank: field selects use the theme surface rather than a native white fill', () => {
  const body = ruleBody(
    questionBankStyles,
    '}\n.cora-bank-editor .field-select {'
  );
  assert.match(body, /background-color:\s*var\(--cora-color-surface\)/);
});

test('Question Bank: the Category field input uses the theme surface rather than a native white fill', () => {
  const body = ruleBody(
    questionBankStyles,
    '}\n.cora-bank-editor .field-input {'
  );
  assert.match(body, /background-color:\s*var\(--cora-color-surface\)/);
});

test('Question Bank: per-option outcome selects use the theme surface and text colour rather than native white chrome', () => {
  const body = ruleBody(
    questionBankStyles,
    '}\n.cora-bank-editor .opt-outcome-select {'
  );
  assert.match(body, /background-color:\s*var\(--cora-color-surface\)/);
  assert.match(body, /color:\s*var\(--cora-color-on-surface\)/);
});

test('Question Bank: stylesheet no longer targets deleted editor custom elements', () => {
  assert.doesNotMatch(
    questionBankStyles,
    /\.cora-bank-editor\s+cora-(?:bank|question|wording|options|outcome|remediation|showwhen|compile)/
  );
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
