// @ts-check
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Capability: the Forms pages share one cora-form-* set and Home has its own
// cora-home-* set, each built on the design tokens alone, so dark mode follows
// the tokens rather than a second set of colours, and each lays out on a phone.

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

/** The page sets this suite holds to the rules, by the class prefix each uses. */
const SETS = [
  { name: 'Form', prefix: 'cora-form-' },
  { name: 'Home', prefix: 'cora-home' },
];

/**
 * Every rule in the stylesheet that styles a class with this prefix, as its
 * selector and declarations.
 *
 * @param {string} prefix
 * @returns {Array<{ selector: string, body: string }>}
 */
function rulesFor(prefix) {
  const withoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({ selector: match[1].trim(), body: match[2] }))
    .filter((rule) => rule.selector.includes(`.${prefix}`));
}

/** Every custom property the stylesheet itself sets, such as an area's tone. */
const declaredHere = new Set(
  [...styles.matchAll(/(--cora-[\w-]+):/g)].map((match) => match[1])
);

test('the Forms pages draw only shared cora-form-* classes, never a page-specific set', () => {
  for (const path of [...FORMS_PAGES, 'src/styles/cora-styles.css']) {
    assert.doesNotMatch(read(path), /cora-forms-/, path);
  }
});

for (const { name, prefix } of SETS) {
  test(`the ${name} styles take every colour from a design token`, () => {
    const rules = rulesFor(prefix);
    assert.ok(rules.length > 0, `the ${name} styles are found`);
    const literal =
      /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|:\s*(?:white|black|red|blue|green|grey|gray)\b/i;
    for (const { selector, body } of rules) {
      assert.doesNotMatch(body, literal, selector);
    }
  });

  test(`every token the ${name} styles name is declared`, () => {
    for (const { selector, body } of rulesFor(prefix)) {
      for (const [, token] of body.matchAll(/var\((--cora-[\w-]+)/g)) {
        assert.ok(
          new RegExp(`${token}:\\s*\\S`).test(tokens) ||
            declaredHere.has(token),
          `${selector} names ${token}, which nothing declares`
        );
      }
    }
  });

  test(`every fixed multi-column ${name} layout collapses to one column on a phone`, () => {
    const narrow = styles.slice(styles.indexOf('@media (max-width: 40rem)'));
    for (const { selector, body } of rulesFor(prefix)) {
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
}
