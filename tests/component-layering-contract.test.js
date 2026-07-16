// @ts-check

/**
 * Layering contract (MAINT-16, completed by the store inversion in #382): the
 * question bank editor subsystem must stay an optional bolt-on, not a
 * dependency anything under `src/components/` reaches into.
 *
 * Two rules are enforced:
 *
 *  1. Generic helpers were relocated to `src/lib/` (showWhen-tree manipulation →
 *     `lib/showwhen-tree.js`; question/category ordering → `lib/question-order.js`;
 *     the transient toast primitive → `lib/toast.js`). No component may import
 *     those concerns from the question-bank subsystem any more.
 *
 *  2. No component imports from the question-bank subsystem at all. The last
 *     ten couplings (editor primitives reading the bank-editor *store
 *     singleton*) were inverted in issue #382: state flows down as properties
 *     (signals allowed as property values) and mutations flow up through
 *     `onCommit` callbacks, with the bank editor page owning the only store
 *     imports.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url);
const COMPONENTS = new URL('src/components/', ROOT);
const SRC = new URL('src/', ROOT);

/** @param {URL} dir @returns {string[]} repo-relative paths of every .js file */
function jsFilesUnder(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) out.push(...jsFilesUnder(child));
    else if (entry.name.endsWith('.js'))
      out.push(child.pathname.slice(ROOT.pathname.length));
  }
  return out;
}

/** @param {string} rel @returns {boolean} whether the file imports from src/pages/question-bank/ */
function importsQuestionBank(rel) {
  const src = readFileSync(new URL(rel, ROOT), 'utf8');
  return /from\s+['"][^'"]*question-bank\//.test(src);
}

/**
 * Read a source file with whole-line comments removed, so JSDoc type references
 * like `@param {() => Promise<typeof import('../pages/cora-home.js')>}` and
 * `// import('../pages/…')` do not trip the page/route import rules below. Only
 * real (non-comment) import statements remain.
 * @param {string} rel @returns {string}
 */
function readCode(rel) {
  return readFileSync(new URL(rel, ROOT), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');
}

const componentFiles = jsFilesUnder(COMPONENTS);
const srcFiles = jsFilesUnder(SRC);

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

test('layering: cora-toast (a base primitive) does not import from question-bank/', () => {
  assert.equal(
    importsQuestionBank('src/components/base/cora-toast.js'),
    false,
    'the base toast reads the transient toast primitive from src/lib/toast.js'
  );
});

test('layering: no component imports from the question-bank subsystem', () => {
  // The last ten couplings (editor primitives reading the bank-editor store
  // singleton) were inverted in issue #382: state flows down as properties
  // (signals allowed as property values) and mutations flow up through
  // `onCommit` callbacks; the bank editor page owns the only store imports.
  const offenders = componentFiles.filter(importsQuestionBank);
  assert.deepEqual(
    offenders,
    [],
    'components must receive question-bank state via props and report mutations via onCommit — see issue #382 and docs/question-bank-store-inversion-explainer.html'
  );
});

/**
 * Page-independence layering (issue #384). Pages load on demand inside their
 * route's `mount()` via dynamic `import()`, guarded by the router error
 * boundary, so a broken page file cannot break the boot graph.
 *
 * Rule (a): no file outside `src/pages/` statically imports a page module, and
 * only route modules may `import()` a page dynamically. `tests/*` is outside
 * this scan by construction.
 */
test('layering: no static page import outside src/pages/; dynamic page import() only in src/routes/', () => {
  // Files that legitimately reach a page module by static import. The in-memory
  // flow runner is a dev/test harness (scripts/run_in_memory_flow.js + tests),
  // not part of the boot graph.
  const STATIC_PAGE_ALLOWLIST = new Set([
    'src/testing/in-memory-flow-runner.js',
  ]);
  // `from '…'` and side-effect `import '…'` are static; `import('…')` is dynamic.
  const staticPage = /(?:from\s+|import\s+)['"][^'"]*\bpages\//;
  const dynamicPage = /import\(\s*['"][^'"]*\bpages\//;

  const staticOffenders = srcFiles.filter((rel) => {
    if (rel.startsWith('src/pages/')) return false;
    if (STATIC_PAGE_ALLOWLIST.has(rel)) return false;
    return staticPage.test(readCode(rel));
  });
  assert.deepEqual(
    staticOffenders,
    [],
    'these files statically import a page — move the import into a route module and `await import()` it inside mount() (see src/routes/*.js)'
  );

  // Dynamic page import() belongs to routes (page loading) or a page composing
  // its own subsystem — never to generic src/ modules, services, or components.
  const dynamicOffenders = srcFiles.filter((rel) => {
    if (rel.startsWith('src/routes/')) return false;
    if (rel.startsWith('src/pages/')) return false;
    return dynamicPage.test(readCode(rel));
  });
  assert.deepEqual(
    dynamicOffenders,
    [],
    'only src/routes/* may dynamically import a page module'
  );
});

/**
 * Rule (b): route modules are `setup/register-routes.js`'s private detail —
 * nothing else imports them (statically or dynamically).
 */
test('layering: src/routes/* is imported only by setup/register-routes.js', () => {
  // Catches `from '…'`, side-effect `import '…'`, and dynamic `import('…')`.
  const routeRef =
    /(?:from\s+|import\s+|import\(\s*)['"][^'"]*\broutes\/[^'"]+\.js/;
  const offenders = srcFiles.filter((rel) => {
    if (rel === 'src/setup/register-routes.js') return false;
    if (rel.startsWith('src/routes/')) return false;
    return routeRef.test(readCode(rel));
  });
  assert.deepEqual(
    offenders,
    [],
    'route modules must be registered only through setup/register-routes.js'
  );
});

/** Repo-relative path a relative import specifier resolves to, or null. */
function resolveRelative(
  /** @type {string} */ fromRel,
  /** @type {string} */ spec
) {
  if (!spec.startsWith('.')) return null;
  const resolved = new URL(spec, new URL(fromRel, ROOT));
  return resolved.pathname.slice(ROOT.pathname.length);
}

/** Every import/dynamic-import specifier in a file (comment lines stripped). */
function importSpecifiers(/** @type {string} */ rel) {
  const re = /(?:from\s+|import\s+|import\(\s*)['"]([^'"]+)['"]/g;
  /** @type {string[]} */
  const specs = [];
  for (const [, spec] of readCode(rel).matchAll(re)) specs.push(spec);
  return specs;
}

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
    for (const spec of importSpecifiers(rel)) {
      const target = resolveRelative(rel, spec);
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
