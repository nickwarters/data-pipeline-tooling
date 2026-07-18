// @ts-check

import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url);

/** @param {string} path */
function read(path) {
  return readFileSync(new URL(path, ROOT), 'utf8');
}

/** @param {string} markdown */
function jsCodeBlocks(markdown) {
  return [...markdown.matchAll(/```js\n([\s\S]*?)```/g)].map(
    (match) => match[1]
  );
}

test('framework contract: component authoring is function-first', () => {
  const doc = read('docs/guide/component-authoring.md');

  assert.match(doc, /Write new UI as plain functions/);
  assert.match(doc, /Do not add lifecycle-backed base classes/);

  for (const block of jsCodeBlocks(doc)) {
    assert.doesNotMatch(block, /extends\s+[A-Z]\w+/);
    assert.doesNotMatch(block, /connectedCallback\s*\(/);
    assert.doesNotMatch(block, /disconnectedCallback\s*\(/);
  }
});

test('framework contract: testing guide does not teach lifecycle-first examples', () => {
  const doc = read('docs/guide/testing.md');

  assert.match(doc, /Function Component Tests/);
  assert.match(doc, /Legacy Shell Tests/);
  assert.doesNotMatch(doc, /TODO\(simplify-ui\)/);

  for (const block of jsCodeBlocks(doc)) {
    assert.doesNotMatch(block, /new\s+CR[A-Z]/);
    assert.doesNotMatch(block, /connectedCallback\s*\(/);
    assert.doesNotMatch(block, /disconnectedCallback\s*\(/);
  }
});

test('framework contract: global component registry stays deleted', () => {
  const app = read('src/app.js');
  const routes = read('src/setup/register-routes.js');

  assert.doesNotMatch(app, /registerComponents|register-components/);
  assert.doesNotMatch(routes, /registerComponents|register-components/);
});

test('framework contract: views do not import persistence services', () => {
  const pageFiles = readdirSync(new URL('src/pages/', ROOT), {
    recursive: true,
  }).filter((path) => String(path).endsWith('.js'));

  for (const path of pageFiles) {
    const source = read(`src/pages/${path}`);
    assert.doesNotMatch(
      source,
      /from\s+['"][^'"]*(?:save-queue|sharepoint-client)\.js['"]/i,
      String(path)
    );
  }
});

test('framework contract: the store-route module boundary is documented', () => {
  const doc = read('docs/guide/store-actions-and-effects.md');

  assert.match(doc, /createRouteSlice/);
  assert.match(doc, /createStoreRoute/);
  assert.match(doc, /listen\(target, type, listener\)/);
  assert.match(doc, /route effect/);
  assert.match(doc, /pure view/);
});
