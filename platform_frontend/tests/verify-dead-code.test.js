// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fixtureTree as fixture } from './_fixture-tree.js';
import { buildGraph, deployableFiles } from '../scripts/verify_build.js';
import { checkDeadCode } from '../scripts/verify-dead-code.js';

/**
 * An entry module exports nothing, as the real `src/app.js` does: nothing
 * imports a host page's script, so an export on it would have no reader.
 */
const BOOT = 'const boot = () => {};\nboot();\n';

/** The minimum a fixture tree needs to have an entry point at all. */
const HOST = {
  'host/index.html':
    '<script type="module" src="{{CORA_BASE}}/src/app.js"></script>\n',
};

/**
 * Build a fixture tree, graph it, and run the dead-code checks over it — the
 * same order the gate itself uses, since the checks assume a resolved graph.
 *
 * @param {Record<string, string>} files
 * @param {Parameters<typeof checkDeadCode>[0]['exemptions']} [exemptions]
 */
function checkTree(files, exemptions) {
  const root = fixture({ ...HOST, ...files });
  const { graph, failures } = buildGraph(deployableFiles(root), root);
  assert.deepEqual(failures, [], 'the fixture graph must resolve first');
  return checkDeadCode({ root, graph, exemptions });
}

/** @param {ReturnType<typeof checkTree>} result @param {string} kind */
function filesReported(result, kind) {
  return result.failures
    .filter((failure) => failure.kind === kind)
    .map((failure) => failure.file);
}

test('a module nothing imports is reported by path', () => {
  const result = checkTree({
    'src/app.js': BOOT,
    'src/orphan.js': 'export const orphan = () => {};\n',
  });

  assert.deepEqual(filesReported(result, 'unreachable'), ['src/orphan.js']);
  assert.match(result.failures[0].message, /nothing imports this module/);
});

test('a transitively reached module is not reported', () => {
  const result = checkTree({
    'src/app.js': "import { a } from './a.js';\nconsole.log(a);\n",
    'src/a.js': "export { b as a } from './b.js';\n",
    'src/b.js': 'export const b = 1;\n',
  });

  assert.deepEqual(result.failures, []);
});

test('a module reached only by a dynamic import is not reported', () => {
  const result = checkTree({
    'src/app.js': "const load = () => import('./lazy.js');\nload();\n",
    'src/lazy.js': 'export const lazy = 1;\n',
  });

  assert.deepEqual(result.failures, []);
});

test('a typedef-only module reached only by a JSDoc type import is not reported', () => {
  const result = checkTree({
    'src/app.js': [
      "/** @typedef {import('./types.js').Row} Row */",
      '/** @param {Row} row */',
      'function boot(row) {',
      '  return row;',
      '}',
      "boot({ id: '1' });",
    ].join('\n'),
    'src/types.js': ['/** @typedef {{ id: string }} Row */', 'export {};'].join(
      '\n'
    ),
  });

  assert.deepEqual(result.failures, []);
});

test('a module reached only from a dev fixture or a tool is not reported', () => {
  const result = checkTree({
    'src/app.js': BOOT,
    'src/for-the-mock.js': 'export const forTheMock = 1;\n',
    'src/for-the-tool.js': 'export const forTheTool = 1;\n',
    'dev/fixtures/people.js':
      "import { forTheMock } from '../../src/for-the-mock.js';\nexport const people = [forTheMock];\n",
    'scripts/tool.js':
      "import { forTheTool } from '../src/for-the-tool.js';\nconsole.log(forTheTool);\n",
  });

  assert.deepEqual(result.failures, []);
});

test("the styleguide's inline module script counts as a reader", () => {
  const result = checkTree({
    'src/app.js': BOOT,
    'src/only-in-the-styleguide.js': 'export const swatch = 1;\n',
    'dev/styleguide.html': [
      '<script type="module">',
      "  import { swatch } from '../src/only-in-the-styleguide.js';",
      '  document.title = String(swatch);',
      '</script>',
    ].join('\n'),
  });

  assert.deepEqual(result.failures, []);
});

test('a module reached only from a test file is reported', () => {
  const result = checkTree({
    'src/app.js': BOOT,
    'src/only-tested.js': 'export const onlyTested = 1;\n',
    'tests/only-tested.test.js':
      "import { onlyTested } from '../src/only-tested.js';\nconsole.log(onlyTested);\n",
  });

  assert.deepEqual(filesReported(result, 'unreachable'), [
    'src/only-tested.js',
  ]);
});

test('a tool reaching a test harness does not launder the harness back into the reachable set', () => {
  const result = checkTree({
    'src/app.js': BOOT,
    'src/only-in-the-harness.js': 'export const helper = 1;\n',
    'scripts/run-flow.js': "import '../tests/_harness.js';\n",
    'tests/_harness.js': "import '../src/only-in-the-harness.js';\n",
  });

  assert.deepEqual(filesReported(result, 'unreachable'), [
    'src/only-in-the-harness.js',
  ]);
});

test('an export nothing imports is reported by name and line', () => {
  const result = checkTree({
    'src/app.js': "import { used } from './lib.js';\nconsole.log(used);\n",
    'src/lib.js': 'export const used = 1;\n\nexport const spare = 2;\n',
  });

  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].kind, 'unused-export');
  assert.equal(result.failures[0].file, 'src/lib.js');
  assert.equal(result.failures[0].line, 3);
  assert.match(
    result.failures[0].message,
    /'spare' is exported but read by nothing/
  );
});

test('an export consumed by any of the import forms is not reported', () => {
  const result = checkTree({
    'src/app.js': [
      "import { named } from './named.js';",
      "import * as ns from './namespaced.js';",
      "import { reexported } from './hub.js';",
      "console.log(named, ns, reexported, import('./lazy.js'));",
    ].join('\n'),
    'src/named.js': 'export const named = 1;\n',
    'src/namespaced.js': 'export const viaNamespace = 1;\n',
    'src/hub.js': "export { reexported } from './reexported.js';\n",
    'src/reexported.js': 'export const reexported = 1;\n',
    'src/lazy.js': 'export const viaDynamicImport = 1;\n',
  });

  assert.deepEqual(result.failures, []);
});

test('a JSDoc type import naming a member consumes only that member', () => {
  const result = checkTree({
    'src/app.js': [
      "/** @typedef {import('./types.js').Row} Row */",
      '/** @param {Row} row */',
      'function boot(row) {',
      '  return row;',
      '}',
      "boot({ id: '1' });",
    ].join('\n'),
    'src/types.js': [
      '/** @typedef {{ id: string }} Row */',
      '/** @typedef {{ id: string }} Column */',
      'export const rowShape = 1;',
      'export const columnShape = 2;',
    ].join('\n'),
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.message),
    [
      "'rowShape' is exported but read by nothing — delete it, or add an entry to PUBLIC_SEAMS saying why it stays",
      "'columnShape' is exported but read by nothing — delete it, or add an entry to PUBLIC_SEAMS saying why it stays",
    ]
  );
});

test('a JSDoc type import naming no member consumes the whole module', () => {
  const result = checkTree({
    'src/app.js': [
      "/** @typedef {typeof import('./types.js')} Types */",
      '/** @param {Types} types */',
      'function boot(types) {',
      '  return types;',
      '}',
      'boot({ rowShape: 1, columnShape: 2 });',
    ].join('\n'),
    'src/types.js': [
      'export const rowShape = 1;',
      'export const columnShape = 2;',
    ].join('\n'),
  });

  assert.deepEqual(result.failures, []);
});

test('a dollar sign in an export name is matched literally, not as an anchor', () => {
  const result = checkTree({
    'src/app.js': "import { entry } from './dollar.js';\nconsole.log(entry);\n",
    'src/dollar.js': [
      'export const usedInternally$ = () => 1;',
      'export const entry = () => usedInternally$();',
      'export const nowhere$ = 2;',
    ].join('\n'),
  });

  assert.deepEqual(
    result.failures.map((failure) => failure.message),
    [
      "'nowhere$' is exported but read by nothing — delete it, or add an entry to PUBLIC_SEAMS saying why it stays",
    ]
  );
});

test('a host page reads names through its inline module script', () => {
  const result = checkTree({
    'host/app.aspx': [
      '<script type="module">',
      "  import { fromTheHostPage } from '../src/host-seam.js';",
      '  document.title = String(fromTheHostPage);',
      '</script>',
    ].join('\n'),
    'src/app.js': "import './host-seam.js';\n",
    'src/host-seam.js': 'export const fromTheHostPage = 1;\n',
  });

  assert.deepEqual(result.failures, []);
});

test('an export named in the exemption list is not reported', () => {
  const files = {
    'src/app.js': BOOT,
    'src/seam.js': 'export const operatorSeam = 1;\n',
    'dev/uses-seam.js': "import '../src/seam.js';\n",
  };

  assert.deepEqual(
    checkTree(files, {
      'src/seam.js': { operatorSeam: 'an operator calls this by hand' },
    }).failures,
    []
  );
  assert.equal(checkTree(files).failures.length, 1);
});

test('an exemption naming something that no longer exists is itself a failure', () => {
  const result = checkTree(
    { 'src/app.js': BOOT },
    {
      'src/gone.js': { gone: 'the file was deleted out from under this entry' },
      'src/app.js': { alsoGone: 'the export was deleted out from under this' },
    }
  );

  assert.deepEqual(
    result.failures.map((failure) => failure.file),
    ['src/gone.js', 'src/app.js']
  );
  for (const failure of result.failures) {
    assert.match(failure.message, /no longer exists — delete the entry/);
  }
});

test('an exemption for an export that now has a consumer is a failure', () => {
  const result = checkTree(
    {
      'src/app.js': "import { used } from './lib.js';\nconsole.log(used);\n",
      'src/lib.js': 'export const used = 1;\n',
    },
    { 'src/lib.js': { used: 'nobody called this when the entry was written' } }
  );

  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].message, /no longer buying anything/);
});

test('an unreachable module is reported once, not once per export', () => {
  const result = checkTree({
    'src/app.js': BOOT,
    'src/orphan.js': 'export const a = 1;\nexport const b = 2;\n',
  });

  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].kind, 'unreachable');
});

test('the real repository has no dead code', () => {
  const root = new URL('../', import.meta.url);
  const { graph, failures } = buildGraph(deployableFiles(root), root);
  assert.deepEqual(failures, [], 'the repository graph must resolve first');

  const { failures: deadCode, counts } = checkDeadCode({ root, graph });

  assert.deepEqual(
    deadCode.map((failure) => `${failure.file} — ${failure.message}`),
    []
  );
  assert.ok(counts.reachable > 0, 'the walk reached something');
  assert.ok(counts.exports > 0, 'the walk accounted for some exports');
});
