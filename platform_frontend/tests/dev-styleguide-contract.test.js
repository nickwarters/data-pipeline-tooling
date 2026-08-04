// @ts-check

/**
 * `dev/styleguide.html` contract.
 *
 * The styleguide is the rendered component reference, and it is the one place
 * in the repo where component code is exercised outside a route and outside a
 * test — which is exactly why it rots quietly. Two failures had already
 * happened at once in the People Picker demo:
 *
 *  1. It hosted a `<cora-people-picker>` element. Nothing registers `cora-*`
 *     elements, so the tag was inert — the sibling `<cora-tabs>` demo was
 *     deleted for this reason and this one was missed.
 *  2. Its module script imported a name (`CORAPeoplePicker`) the module does
 *     not export, so the *whole* `<script type="module">` block threw at parse
 *     and the demo silently rendered nothing.
 *
 * Neither is visible to any other test: the styleguide is not under `src/`, so
 * `tests/cora-element-type-contract.test.js` never scans it, and nothing
 * imports it. These two checks are the ratchet for that blind spot.
 */

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url);
const HTML_PAGES = ['dev/styleguide.html', 'dev/index.html'];

/** @param {string} rel @returns {string} */
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

/**
 * Every `<cora-…>` element host in an HTML page — an opening tag whose name
 * carries the `cora-` prefix.
 * @param {string} html @returns {string[]}
 */
export function coraElementHosts(html) {
  return [...html.matchAll(/<(cora-[\w-]+)[\s/>]/g)].map((m) => m[1]);
}

/**
 * Every named import in the page's `<script type="module">` blocks, as
 * `{ specifier, names }` — enough to check each name is really exported.
 * @param {string} html
 * @returns {{ specifier: string, names: string[] }[]}
 */
export function moduleScriptNamedImports(html) {
  /** @type {{ specifier: string, names: string[] }[]} */
  const out = [];
  for (const block of html.matchAll(
    /<script\s+type="module"\s*>([\s\S]*?)<\/script>/g
  )) {
    for (const stmt of block[1].matchAll(
      /^\s*import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm
    )) {
      out.push({
        specifier: stmt[2],
        names: stmt[1]
          .split(',')
          .map((n) =>
            n
              .trim()
              .split(/\s+as\s+/)[0]
              .trim()
          )
          .filter(Boolean),
      });
    }
  }
  return out;
}

test('no dev page hosts an inert cora-* element', () => {
  const offenders = HTML_PAGES.flatMap((rel) =>
    coraElementHosts(read(rel)).map((tag) => `${rel} → <${tag}>`)
  );
  assert.deepEqual(
    offenders,
    [],
    'nothing registers `cora-*` elements, so the tag renders as an inert unknown element — mount a plain host and render the pure view into it'
  );
});

test('the styleguide detectors find what they are looking for', () => {
  assert.deepEqual(coraElementHosts('<cora-tabs id="x"></cora-tabs>'), [
    'cora-tabs',
  ]);
  assert.deepEqual(coraElementHosts('<div class="cora-tabs"></div>'), []);
  assert.deepEqual(
    moduleScriptNamedImports(
      '<script type="module">\nimport { A, B as C } from "./m.js";\n</script>'
    ),
    [{ specifier: './m.js', names: ['A', 'B'] }]
  );
});

test('every named import in a dev module script really is exported', async () => {
  const imports = moduleScriptNamedImports(read('dev/styleguide.html'));
  assert.ok(imports.length > 0, 'expected the styleguide to import something');
  for (const { specifier, names } of imports) {
    const module = await import(
      new URL(specifier, new URL('dev/styleguide.html', ROOT)).href
    );
    for (const name of names) {
      assert.ok(
        name in module,
        `dev/styleguide.html imports { ${name} } from '${specifier}', which does not export it — the whole module script would throw at parse`
      );
    }
  }
});
