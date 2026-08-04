// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fixtureTree as fixture } from './_fixture-tree.js';
import {
  exportedNames,
  importedNames,
  jsFilesUnder,
  readCode,
  importSpecifiers,
  resolveRelative,
  typeReferences,
} from '../scripts/module-graph.js';

test('importSpecifiers reports specifier, kind and line for every static form', () => {
  const root = fixture({
    'a.js': [
      "import def from './def.js';",
      "import './side-effect.js';",
      'import {',
      '  named,',
      "} from './named.js';",
      "export { reexported } from './reexport.js';",
      "export * from './star.js';",
    ].join('\n'),
  });

  assert.deepEqual(importSpecifiers('a.js', root), [
    { specifier: './def.js', kind: 'static', line: 1 },
    { specifier: './side-effect.js', kind: 'static', line: 2 },
    { specifier: './named.js', kind: 'static', line: 5 },
    { specifier: './reexport.js', kind: 'static', line: 6 },
    { specifier: './star.js', kind: 'static', line: 7 },
  ]);
});

test('importSpecifiers reports import() as a dynamic edge', () => {
  const root = fixture({
    'a.js': [
      'export async function load() {',
      "  return import('./lazy.js');",
      '}',
    ].join('\n'),
  });

  assert.deepEqual(importSpecifiers('a.js', root), [
    { specifier: './lazy.js', kind: 'dynamic', line: 2 },
  ]);
});

test('importSpecifiers ignores a string ending in the word "from"', () => {
  const root = fixture({
    'a.js': [
      'export const message =',
      "  'You are seeing the current Question Bank, which may differ from ' +",
      "  'what was reviewed at the time.';",
    ].join('\n'),
  });

  assert.deepEqual(importSpecifiers('a.js', root), []);
});

test('importSpecifiers ignores an export statement whose value is a string', () => {
  const root = fixture({ 'a.js': "export const NA_VALUE = 'n/a';\n" });

  assert.deepEqual(importSpecifiers('a.js', root), []);
});

test('importSpecifiers ignores an inline JSDoc cast containing import()', () => {
  const root = fixture({
    'a.js': [
      'export function read() {',
      "  return /** @type {import('./types.js').Thing} */ (parse());",
      '}',
    ].join('\n'),
  });

  assert.deepEqual(importSpecifiers('a.js', root), []);
});

test('importSpecifiers ignores whole-line comments', () => {
  const root = fixture({
    'a.js': [
      "// import './commented.js';",
      '/**',
      " * @param {() => Promise<typeof import('./page.js')>} loader",
      ' */',
      "import { real } from './real.js';",
    ].join('\n'),
  });

  assert.deepEqual(importSpecifiers('a.js', root), [
    { specifier: './real.js', kind: 'static', line: 5 },
  ]);
});

test('readCode preserves line numbers while blanking comments', () => {
  const root = fixture({
    'a.js': [
      '// leading comment',
      '/**',
      ' * doc',
      ' */',
      'const value = /** @type {string} */ (raw);',
    ].join('\n'),
  });

  const code = readCode('a.js', root);
  const lines = code.split('\n');
  assert.equal(lines.length, 5);
  assert.equal(lines[0], '');
  assert.equal(lines[3], '');
  assert.match(lines[4], /^const value =\s+\(raw\);$/);
});

test('resolveRelative resolves relative specifiers to repo-relative paths', () => {
  const root = fixture({ 'a.js': '' });

  assert.equal(
    resolveRelative('src/pages/home.js', '../lib/html.js', root),
    'src/lib/html.js'
  );
  assert.equal(
    resolveRelative('src/pages/home.js', './home/view.js', root),
    'src/pages/home/view.js'
  );
});

test('resolveRelative returns null for node: and bare specifiers', () => {
  const root = fixture({ 'a.js': '' });

  assert.equal(resolveRelative('src/app.js', 'node:fs/promises', root), null);
  assert.equal(resolveRelative('src/app.js', 'lodash', root), null);
});

test('jsFilesUnder returns repo-relative paths and recurses', () => {
  const root = fixture({
    'src/app.js': '',
    'src/lib/html.js': '',
    'src/styles/cora.css': '',
    'case-types/complaints.js': '',
  });

  assert.deepEqual(jsFilesUnder(new URL('src/', root), root).sort(), [
    'src/app.js',
    'src/lib/html.js',
  ]);
  assert.deepEqual(jsFilesUnder(new URL('case-types/', root), root), [
    'case-types/complaints.js',
  ]);
});

test('typeReferences finds JSDoc type imports, with and without a member', () => {
  const root = fixture({
    'a.js': [
      "/** @typedef {import('./types.js').Foo} Foo */",
      "/** @type {import('./whole.js')} */",
      "/** @typedef {import('node:fs').Stats} Stats */",
      "/** @typedef {import('some-package').Thing} Thing */",
    ].join('\n'),
  });

  assert.deepEqual(typeReferences('a.js', root), [
    { specifier: './types.js', name: 'Foo' },
    { specifier: './whole.js', name: '*' },
  ]);
});

test('typeReferences reads a member off a typeof import', () => {
  const root = fixture({
    'a.js':
      "/** @type {ReturnType<typeof import('./view.js').createView>} */\n",
  });

  assert.deepEqual(typeReferences('a.js', root), [
    { specifier: './view.js', name: 'createView' },
  ]);
});

test('exportedNames reports declarations, braces and default with their lines', () => {
  const root = fixture({
    'a.js': [
      'export const value = 1;',
      'export async function work() {}',
      'export class Thing {}',
      'const hidden = 2;',
      'export { hidden as shown };',
      'export default work;',
    ].join('\n'),
  });

  assert.deepEqual(exportedNames('a.js', root), [
    { name: 'value', line: 1 },
    { name: 'work', line: 2 },
    { name: 'Thing', line: 3 },
    { name: 'shown', line: 5 },
    { name: 'default', line: 6 },
  ]);
});

test('exportedNames treats an empty export clause as exporting nothing', () => {
  const root = fixture({ 'a.js': 'export {};\n' });

  assert.deepEqual(exportedNames('a.js', root), []);
});

test('exportedNames reports the local name of a re-export', () => {
  const root = fixture({ 'a.js': "export { a as b } from './x.js';\n" });

  assert.deepEqual(exportedNames('a.js', root), [{ name: 'b', line: 1 }]);
});

test('importedNames reports which names each specifier is read for', () => {
  const root = fixture({
    'a.js': [
      "import * as ns from './ns.js';",
      "import def from './def.js';",
      "import other, { a as b, c } from './named.js';",
      "export { a as b } from './reexport.js';",
      "const lazy = import('./lazy.js');",
    ].join('\n'),
  });

  assert.deepEqual(importedNames('a.js', root), [
    { specifier: './ns.js', names: '*' },
    { specifier: './def.js', names: ['default'] },
    { specifier: './named.js', names: ['default', 'a', 'c'] },
    { specifier: './reexport.js', names: ['a'] },
    { specifier: './lazy.js', names: '*' },
  ]);
});
