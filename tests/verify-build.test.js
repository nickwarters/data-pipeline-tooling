// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fixtureTree as fixture } from './_fixture-tree.js';
import {
  assetReferences,
  attachDerivedEdges,
  buildGraph,
  checkSyntax,
  deployableFiles,
} from '../scripts/verify_build.js';

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

test('assetReferences reads a stylesheet @import in both spellings', () => {
  const root = fixture({
    'src/styles/a.css':
      "@import url('./tokens.css');\n@import './extra.css';\n",
    'src/styles/tokens.css': ':root { --x: 1px; }\n',
    'src/styles/extra.css': '',
  });

  assert.deepEqual(assetReferences('src/styles/a.css', root), [
    {
      specifier: './tokens.css',
      resolved: 'src/styles/tokens.css',
      kind: 'css-import',
      line: 1,
    },
    {
      specifier: './extra.css',
      resolved: 'src/styles/extra.css',
      kind: 'css-import',
      line: 2,
    },
  ]);
});

test('assetReferences ignores an @import inside a stylesheet comment', () => {
  const root = fixture({
    'src/styles/a.css':
      '/*\n  Historical note:\n  @import "./removed.css";\n*/\n@import "./real.css";\n',
    'src/styles/real.css': '',
  });

  assert.deepEqual(
    assetReferences('src/styles/a.css', root).map(
      (reference) => reference.specifier
    ),
    ['./real.css']
  );
});

test('assetReferences resolves host-page link and script refs from the repo root', () => {
  const root = fixture({
    'host/index.html':
      '<link rel="stylesheet" href="{{CORA_BASE}}/src/styles/a.css" />\n' +
      '<script type="module" src="{{CORA_BASE}}/src/app.js"></script>\n',
    'src/styles/a.css': '',
    'src/app.js': '',
  });

  assert.deepEqual(assetReferences('host/index.html', root), [
    {
      specifier: '{{CORA_BASE}}/src/styles/a.css',
      resolved: 'src/styles/a.css',
      kind: 'html-ref',
      line: 1,
    },
    {
      specifier: '{{CORA_BASE}}/src/app.js',
      resolved: 'src/app.js',
      kind: 'html-ref',
      line: 2,
    },
  ]);
});

test('assetReferences ignores host-page refs the deploy does not own', () => {
  const root = fixture({
    'host/index.html':
      '<link rel="stylesheet" href="https://sp.example.com/x.css" />\n' +
      '<link rel="stylesheet" href="//cdn.example.com/y.css" />\n' +
      '<link rel="stylesheet" href="/_layouts/15/z.css" />\n' +
      '<script src="/_layouts/15/init.js"></script>\n' +
      '<!-- <script src="{{CORA_BASE}}/src/commented-out.js"></script> -->\n',
  });

  assert.deepEqual(assetReferences('host/index.html', root), []);
});

test('buildGraph fails a dangling asset reference, naming the file and specifier', () => {
  const root = fixture({
    'src/styles/a.css': "@import './gone.css';\n",
    'host/index.html': '<script src="{{CORA_BASE}}/src/missing.js"></script>\n',
  });

  const { failures } = buildGraph(
    ['host/index.html', 'src/styles/a.css'],
    root
  );

  assert.deepEqual(
    failures.map((failure) => [failure.file, failure.specifier, failure.kind]),
    [
      ['host/index.html', '{{CORA_BASE}}/src/missing.js', 'unresolved'],
      ['src/styles/a.css', './gone.css', 'unresolved'],
    ]
  );
});

test('attachDerivedEdges reports a case-mismatched bank artifact as a case mismatch', () => {
  const root = fixture({
    'case-types/complaints.js': '',
    'case-types/banks/complaints.txt': '{}',
  });
  const { graph } = buildGraph(
    ['case-types/complaints.js', 'case-types/banks/complaints.txt'],
    root
  );

  const failures = attachDerivedEdges(
    graph,
    [
      {
        from: 'case-types/complaints.js',
        specifier: './banks/Complaints.txt',
        resolved: 'case-types/banks/Complaints.txt',
        kind: 'bank',
      },
    ],
    root
  );

  assert.equal(failures.length, 1);
  assert.equal(failures[0].file, 'case-types/complaints.js');
  assert.match(failures[0].message, /case mismatch/);
  assert.deepEqual(graph.nodes['case-types/complaints.js'].imports, []);
});

test('attachDerivedEdges adds the bank artifact edge to its Case Type module', () => {
  const root = fixture({
    'case-types/complaints.js': '',
    'case-types/banks/complaints.txt': '{}',
  });
  const { graph } = buildGraph(
    ['case-types/complaints.js', 'case-types/banks/complaints.txt'],
    root
  );

  const failures = attachDerivedEdges(
    graph,
    [
      {
        from: 'case-types/complaints.js',
        specifier: './banks/complaints.txt',
        resolved: 'case-types/banks/complaints.txt',
        kind: 'bank',
      },
    ],
    root
  );

  assert.deepEqual(failures, []);
  assert.deepEqual(graph.nodes['case-types/complaints.js'].imports, [
    {
      specifier: './banks/complaints.txt',
      resolved: 'case-types/banks/complaints.txt',
      kind: 'bank',
    },
  ]);
});

test('deployableFiles mirrors the deploy include rules, so every uploaded file has a node', () => {
  const root = fixture({
    'src/app.js': '',
    'src/styles/a.css': '',
    'src/notes.txt': 'stray tool artefact',
    'case-types/manifest.js': '',
    'case-types/banks/complaints.txt': '{}',
    'host/index.html': '',
    'host/legacy.aspx': '',
    'dev/index.html': '',
    'tests/x.test.js': '',
  });

  const files = deployableFiles(root);

  assert.deepEqual(files, [
    'case-types/banks/complaints.txt',
    'case-types/manifest.js',
    'host/index.html',
    'host/legacy.aspx',
    'src/app.js',
    'src/styles/a.css',
  ]);
  assert.deepEqual(Object.keys(buildGraph(files, root).graph.nodes), files);
});

test('buildGraph records the version and the include rules it scanned', () => {
  const root = fixture({ 'src/app.js': '' });

  const { graph } = buildGraph(['src/app.js'], root);

  assert.equal(graph.version, 2);
  assert.deepEqual(graph.deployable, {
    includeRoots: ['src', 'case-types', 'host'],
    includeSuffixes: ['.js', '.css', '.html', '.aspx'],
    bankDir: 'case-types/banks',
    bankSuffix: '.txt',
  });
});
