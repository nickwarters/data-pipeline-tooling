// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fixtureTree as fixture } from './_fixture-tree.js';
import { buildGraph, checkSyntax } from '../scripts/verify_build.js';

test('checkSyntax names the file that will not parse', async () => {
  const root = fixture({
    'src/broken.js': 'export function oops( {\n',
    'src/fine.js': 'export const fine = 1;\n',
  });

  const failures = await checkSyntax(['src/broken.js', 'src/fine.js'], root);

  assert.equal(failures.length, 1);
  assert.equal(failures[0].kind, 'syntax');
  assert.equal(failures[0].file, 'src/broken.js');
  assert.ok(
    failures[0].message.length > 0,
    'a syntax failure carries a reason'
  );
});

test('checkSyntax passes a tree that parses', async () => {
  const root = fixture({
    'src/app.js': "import './lib.js';\n",
    'src/lib.js': '',
  });

  assert.deepEqual(await checkSyntax(['src/app.js', 'src/lib.js'], root), []);
});

test('buildGraph reports an unresolved specifier by file and specifier', () => {
  const root = fixture({ 'src/app.js': "import './nope.js';\n" });

  const { failures } = buildGraph(['src/app.js'], root);

  assert.equal(failures.length, 1);
  assert.equal(failures[0].kind, 'unresolved');
  assert.equal(failures[0].file, 'src/app.js');
  assert.equal(failures[0].specifier, './nope.js');
});

test('buildGraph reports a case-mismatched specifier with the on-disk spelling', () => {
  // Only the lowercase file exists: creating both spellings would collapse into
  // one entry on a case-insensitive disk and change what this test proves.
  const root = fixture({
    'src/app.js': "import './foo.js';\nimport './Foo.js';\n",
    'src/foo.js': 'export const foo = 1;\n',
  });

  const { failures } = buildGraph(['src/app.js', 'src/foo.js'], root);

  assert.equal(failures.length, 1);
  assert.equal(failures[0].kind, 'unresolved');
  assert.equal(failures[0].file, 'src/app.js');
  assert.equal(failures[0].specifier, './Foo.js');
  assert.match(
    failures[0].message,
    /foo\.js/,
    'the failure names the spelling that is actually on disk'
  );
});

test('buildGraph fails a specifier that resolves to a directory', () => {
  const root = fixture({
    'src/app.js': "import './lib';\n",
    'src/lib/html.js': 'export const h = () => {};\n',
  });

  const { failures } = buildGraph(['src/app.js', 'src/lib/html.js'], root);

  assert.equal(failures.length, 1);
  assert.equal(failures[0].file, 'src/app.js');
  assert.equal(failures[0].specifier, './lib');
  assert.match(failures[0].message, /director(y|ies)/);
});

test('buildGraph records a node: specifier as external, not a failure', () => {
  const root = fixture({
    'src/app.js': "export const read = () => import('node:fs/promises');\n",
  });

  const { failures, graph } = buildGraph(['src/app.js'], root);

  assert.deepEqual(failures, []);
  assert.deepEqual(graph.external, ['node:fs/promises']);
  assert.deepEqual(graph.nodes['src/app.js'].imports, [
    {
      specifier: 'node:fs/promises',
      resolved: null,
      kind: 'dynamic',
      line: 1,
    },
  ]);
});

test('buildGraph fails a bare package specifier', () => {
  const root = fixture({ 'src/app.js': "import 'lodash';\n" });

  const { failures } = buildGraph(['src/app.js'], root);

  assert.equal(failures.length, 1);
  assert.equal(failures[0].file, 'src/app.js');
  assert.equal(failures[0].specifier, 'lodash');
});

test('buildGraph resolves a clean tree with sorted, deterministic output', () => {
  const root = fixture({
    'src/app.js':
      "import './lib/html.js';\nimport '../case-types/complaints.js';\n",
    'src/lib/html.js': 'export const h = () => {};\n',
    'case-types/complaints.js': "import '../dev/fixtures/cases.js';\n",
    'dev/fixtures/cases.js': 'export const cases = [];\n',
  });
  const files = [
    'src/app.js',
    'src/lib/html.js',
    'case-types/complaints.js',
    'dev/fixtures/cases.js',
  ];

  const first = buildGraph(files, root);

  assert.deepEqual(first.failures, []);
  assert.deepEqual(Object.keys(first.graph.nodes), [
    'case-types/complaints.js',
    'dev/fixtures/cases.js',
    'src/app.js',
    'src/lib/html.js',
  ]);
  assert.deepEqual(first.graph.nodes['src/app.js'].imports, [
    {
      specifier: './lib/html.js',
      resolved: 'src/lib/html.js',
      kind: 'static',
      line: 1,
    },
    {
      specifier: '../case-types/complaints.js',
      resolved: 'case-types/complaints.js',
      kind: 'static',
      line: 2,
    },
  ]);

  // Nothing in the artifact varies between runs.
  assert.equal(
    JSON.stringify(first.graph),
    JSON.stringify(buildGraph(files, root).graph)
  );
});
