// @ts-check

import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url);

/** @param {string} path */
function read(path) {
  return readFileSync(new URL(path, ROOT), 'utf8');
}

/**
 * Report app-layer class components from an injectable source set. Keeping the
 * source set injectable proves the contract catches representative legacy code
 * instead of merely agreeing with today's tree.
 *
 * @param {Array<{path: string, source: string}>} files
 * @returns {string[]}
 */
export function classComponentViolations(files) {
  return files
    .filter(({ path }) =>
      /^(?:src\/(?:actions|components|pages|routes|setup|views)\/)/.test(path)
    )
    .filter(({ source }) =>
      /\bclass\s+\w+\s+extends\s+(?:HTMLElement|\w*(?:Element|Component))\b/.test(
        source
      )
    )
    .map(({ path }) => path);
}

/** @param {Array<{path: string, source: string}>} files @returns {string[]} */
export function legacyFrameworkViolations(files) {
  return files
    .filter(({ source }) =>
      /\b(?:ShellElement|defineView)\b|\breactive\s*\(/.test(source)
    )
    .map(({ path }) => path);
}

/** @param {Array<{path: string, source: string}>} files @returns {string[]} */
export function appSignalImportViolations(files) {
  return files
    .filter(({ path }) =>
      /^(?:src\/(?:actions|components|pages|routes|setup|views)\/)/.test(path)
    )
    .filter(({ source }) => /\bfrom\s+['"][^'"]*\/signal\.js['"]/.test(source))
    .map(({ path }) => path);
}

/** @param {Array<{path: string, source: string}>} files @returns {string[]} */
export function viewClientImportViolations(files) {
  return files
    .filter(({ path }) =>
      /(?:^src\/(?:components|pages|views)\/|(?:^|\/)[^/]*-view\.js$)/.test(
        path
      )
    )
    .filter(({ source }) =>
      /\bfrom\s+['"][^'"]*(?:sharepoint-client|save-queue)\.js['"]/.test(source)
    )
    .map(({ path }) => path);
}

/** @returns {Array<{path: string, source: string}>} */
function sourceFiles() {
  const paths = readdirSync(new URL('src/', ROOT), { recursive: true })
    .map(String)
    .filter((path) => path.endsWith('.js'));
  return paths.map((path) => ({
    path: `src/${path}`,
    source: read(`src/${path}`),
  }));
}

test('framework contract: representative class components are rejected', () => {
  assert.deepEqual(
    classComponentViolations([
      {
        path: 'src/components/legacy-widget.js',
        source: 'export class LegacyWidget extends HTMLElement {}',
      },
    ]),
    ['src/components/legacy-widget.js']
  );
});

test('framework contract: application UI has no class components', () => {
  assert.deepEqual(classComponentViolations(sourceFiles()), []);
});

test('framework contract: representative legacy framework APIs are rejected', () => {
  assert.deepEqual(
    legacyFrameworkViolations([
      {
        path: 'src/components/legacy-one.js',
        source: "import { ShellElement } from '../lib/view.js';",
      },
      {
        path: 'src/components/legacy-two.js',
        source: "export const Legacy = defineView('cora-legacy', {});",
      },
      {
        path: 'src/components/legacy-three.js',
        source: 'export const Legacy = reactive(() => view());',
      },
    ]),
    [
      'src/components/legacy-one.js',
      'src/components/legacy-two.js',
      'src/components/legacy-three.js',
    ]
  );
});

test('framework contract: legacy view APIs cannot return to source', () => {
  assert.deepEqual(legacyFrameworkViolations(sourceFiles()), []);
});

test('framework contract: representative app-layer signal imports are rejected', () => {
  assert.deepEqual(
    appSignalImportViolations([
      {
        path: 'src/pages/legacy-page.js',
        source: "import { signal } from '../lib/signal.js';",
      },
    ]),
    ['src/pages/legacy-page.js']
  );
});

test('framework contract: application surfaces do not import signals', () => {
  assert.deepEqual(appSignalImportViolations(sourceFiles()), []);
});

test('framework contract: representative view-to-client imports are rejected', () => {
  assert.deepEqual(
    viewClientImportViolations([
      {
        path: 'src/pages/orders-view.js',
        source:
          "import { HttpSharePointClient } from '../services/http-sharepoint-client.js';",
      },
    ]),
    ['src/pages/orders-view.js']
  );
});

test('framework contract: views never import clients', () => {
  assert.deepEqual(viewClientImportViolations(sourceFiles()), []);
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
