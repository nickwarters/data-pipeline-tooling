// @ts-check

/**
 * Layering contract, completed by the store inversion: the
 * question bank editor subsystem must stay an optional bolt-on, not a
 * dependency anything under `src/components/` reaches into.
 *
 * Two rules are enforced:
 *
 *  1. Generic helpers were relocated to `src/lib/` (showWhen-tree manipulation →
 *     `lib/showwhen-tree.js`; question/category ordering → `lib/question-order.js`).
 *     No component may import those concerns from the question-bank subsystem
 *     any more.
 *
 *  2. No component imports from the question-bank subsystem at all. The last
 *     former couplings have now moved into the store-driven bank page as pure
 *     views. Shared components do not know about bank state or actions.
 */

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  jsFilesUnder,
  readCode,
  importSpecifiers,
  resolveRelative,
} from '../scripts/module-graph.js';

const ROOT = new URL('../', import.meta.url);
const COMPONENTS = new URL('src/components/', ROOT);
const SRC = new URL('src/', ROOT);

/** @param {string} rel @returns {boolean} whether the file imports from src/pages/question-bank/ */
function importsQuestionBank(rel) {
  // Reads the raw bytes rather than the shared scanner on purpose: this is a
  // name check, and a commented-out reference to the subsystem is still a
  // coupling worth failing on.
  const src = readFileSync(new URL(rel, ROOT), 'utf8');
  return /from\s+['"][^'"]*question-bank\//.test(src);
}

const componentFiles = jsFilesUnder(COMPONENTS, ROOT);
const srcFiles = jsFilesUnder(SRC, ROOT);

test('layering: no component imports the relocated generic helpers from question-bank/', () => {
  const offenders = componentFiles.filter((rel) => {
    const src = readFileSync(new URL(rel, ROOT), 'utf8');
    return /question-bank\/question-bank-(tree|order)\.js/.test(src);
  });
  assert.deepEqual(
    offenders,
    [],
    'these files must import showWhen-tree/order helpers from src/lib/, not src/pages/question-bank/'
  );
});

test('layering: no component imports from the question-bank subsystem', () => {
  // Question Bank editor views live under the page and dispatch plain actions;
  // shared components remain independent of that route.
  const offenders = componentFiles.filter(importsQuestionBank);
  assert.deepEqual(
    offenders,
    [],
    'shared components must not depend on the Question Bank page'
  );
});

/**
 * Page-independence layering. Pages load on demand inside their
 * route's `mount()` via dynamic `import()`, guarded by the router error
 * boundary, so a broken page file cannot break the boot graph.
 *
 * No file outside `src/pages/` statically imports a page module, and only the
 * route table may `import()` a page dynamically. `tests/*` is outside this scan
 * by construction.
 */
test('layering: no static page import outside src/pages/; dynamic page import() only in the route table', () => {
  const isPageSpecifier = /\bpages\//;

  /**
   * Offending `file:line -> specifier` strings, for every edge of one kind
   * whose specifier names a page module.
   * @param {import('../scripts/module-graph.js').ImportKind} kind
   * @param {(rel: string) => boolean} [exempt]
   * @returns {string[]}
   */
  const pageEdges = (kind, exempt = () => false) => {
    /** @type {string[]} */
    const out = [];
    for (const rel of srcFiles) {
      if (rel.startsWith('src/pages/') || exempt(rel)) continue;
      for (const edge of importSpecifiers(rel, ROOT)) {
        if (edge.kind === kind && isPageSpecifier.test(edge.specifier)) {
          out.push(`${rel}:${edge.line} -> ${edge.specifier}`);
        }
      }
    }
    return out;
  };

  assert.deepEqual(
    pageEdges('static'),
    [],
    'these files statically import a page — add it to the route table in setup/register-routes.js as an `import()` thunk instead'
  );

  // Dynamic page import() belongs to the route table (page loading) or a page
  // composing its own subsystem — never to generic src/ modules, services, or
  // components.
  assert.deepEqual(
    pageEdges('dynamic', (rel) => rel === 'src/setup/register-routes.js'),
    [],
    'only the route table in setup/register-routes.js may dynamically import a page module'
  );
});

/**
 * Boot is one static graph, and a failed boot must be visible rather than
 * console-only. Everything `src/app.js` needs is fatal to boot anyway, so
 * deferring it contained nothing and only made boot serial; the boundaries
 * that DO contain a failure are reached from other modules.
 *
 * Scanned as source rather than imported: importing `app.js` runs `boot()`.
 */
test('boot: src/app.js is a static graph that renders a panel when boot fails', () => {
  const code = readCode('src/app.js', ROOT);
  assert.doesNotMatch(code, /import\(/, 'src/app.js must import statically');
  assert.match(
    code,
    /boot\(\)\.catch\(\s*renderBootError\s*\)/,
    'src/app.js must hand a failed boot to renderBootError'
  );
});

/**
 * Rule (c): the only accepted cross-import between top-level page modules is
 * `cora-dashboard.js` → `cora-responsible-party-dashboard.js` (the dashboard
 * embeds the responsible-party panel, which is itself routed by my-cases). All
 * other top-level pages must stay independent so deleting one cannot break
 * another. Intra-subsystem imports (src/pages/<sub>/*) are unrestricted. This
 * resolves every specifier (static, side-effect, and dynamic) so the coupling
 * cannot slip back in via `import '…'`, `../pages/…`, or a subsystem file.
 */
test('layering: no file under src/pages/ imports another top-level page (one documented exception)', () => {
  /** @type {Record<string, string[]>} rel -> allowed target rels */
  const CROSS_PAGE_ALLOWLIST = {
    'src/pages/cora-dashboard.js': [
      'src/pages/cora-responsible-party-dashboard.js',
    ],
  };
  const topLevelPage = /^src\/pages\/[^/]+\.js$/;
  /** @type {string[]} */
  const offenders = [];
  for (const rel of srcFiles) {
    if (!rel.startsWith('src/pages/')) continue;
    const allowed = CROSS_PAGE_ALLOWLIST[rel] ?? [];
    for (const { specifier } of importSpecifiers(rel, ROOT)) {
      const target = resolveRelative(rel, specifier, ROOT);
      if (!target || target === rel) continue;
      if (topLevelPage.test(target) && !allowed.includes(target)) {
        offenders.push(`${rel} -> ${target}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'files under src/pages/ must not import another top-level page module (extend CROSS_PAGE_ALLOWLIST only with a documented reason)'
  );
});
