// @ts-check
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Capability: every Forms page is styled by one shared cora-form-* set, built
// on the design tokens alone, so the pages agree with each other and dark mode
// follows the tokens rather than a second set of colours.

const ROOT = new URL('../', import.meta.url);
/** @param {string} path */
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');

const styles = read('src/styles/cora-styles.css');
const tokens = read('src/styles/cora-design-tokens.css');

/** The Forms pages' modules: the two route modules and everything under forms/. */
const FORMS_PAGES = [
  'src/pages/cora-forms.js',
  'src/pages/cora-form.js',
  ...readdirSync(new URL('src/pages/forms/', ROOT))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `src/pages/forms/${name}`),
];

/**
 * Every rule in the stylesheet that styles a cora-form-* class, as its
 * selector and declarations.
 *
 * @returns {Array<{ selector: string, body: string }>}
 */
function formRules() {
  const withoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({ selector: match[1].trim(), body: match[2] }))
    .filter((rule) => /\.cora-form-/.test(rule.selector));
}

test('the Forms pages draw only shared cora-form-* classes, never a page-specific set', () => {
  for (const path of [...FORMS_PAGES, 'src/styles/cora-styles.css']) {
    assert.doesNotMatch(read(path), /cora-forms-/, path);
  }
});

test('the shared Form styles take every colour from a design token', () => {
  const rules = formRules();
  assert.ok(rules.length > 0, 'the Form styles are found');
  const literal =
    /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|:\s*(?:white|black|red|blue|green|grey|gray)\b/i;
  for (const { selector, body } of rules) {
    assert.doesNotMatch(body, literal, selector);
  }
});

test('every token the shared Form styles name is declared', () => {
  for (const { selector, body } of formRules()) {
    for (const [, token] of body.matchAll(/var\((--cora-[\w-]+)/g)) {
      assert.match(
        tokens,
        new RegExp(`${token}:\\s*\\S`),
        `${selector} names ${token}, which no theme declares`
      );
    }
  }
});

test('every two-column Form layout collapses to one column on a phone', () => {
  const narrow = styles.slice(styles.indexOf('@media (max-width: 40rem)'));
  for (const { selector, body } of formRules()) {
    const columns = body.match(/grid-template-columns:\s*([^;]+);/);
    if (!columns || /auto-fit|auto-fill|^1fr$/.test(columns[1].trim()))
      continue;
    for (const part of selector.split(',').map((each) => each.trim())) {
      assert.match(
        narrow,
        new RegExp(`${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s,{]`),
        `${part} keeps its columns at phone width`
      );
    }
  }
});
