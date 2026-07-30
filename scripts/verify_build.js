// @ts-check

/**
 * Verify gate: resolve the deployed module graph the way the browser will, and
 * emit it as an artifact.
 *
 * `npm run check` runs first and tsc already flags a dangling specifier and a
 * case-mismatched one. Three things this adds on top: the graph JSON, so a
 * later step can order or preload modules without re-deriving it; rejection of
 * bare package specifiers, which tsc happily resolves through `node_modules`
 * while the browser cannot, there being no transform step to rewrite them; and
 * Node's own parser rather than tsc's.
 *
 * Resolution reads directory entries and compares exact strings, because
 * SharePoint serves paths case-sensitively while a developer's macOS disk does
 * not: `existsSync`/`readFileSync` would answer "yes" to the wrong case and
 * defeat the check. The last segment must be a file, since a directory
 * specifier resolves on disk and 404s in the browser.
 *
 * Non-relative specifiers: the only one accepted is the `node:` built-in
 * scheme. The deployed tree contains exactly one — the Question Bank loader's
 * `import('node:fs/promises')`, reached only when the bank URL has a `file:`
 * protocol, which is the Node test path and never the browser's. Built-in
 * specifiers are recorded as external edges and never path-resolved, because
 * there is no path to resolve. Every other bare specifier is a failure: a bare
 * package name means a runtime dependency, which this project does not have.
 *
 * Scope for the graph is every file the deploy uploads, not only the modules:
 * the include roots and suffixes here mirror the deploy script's, so each
 * uploaded file has a node and the deploy can order `.css`, `.html` and the
 * Question Bank `.txt` artifacts as well as the modules. The artifact records
 * the rules it scanned under, and the deploy asserts they match its own
 * constants — drift between the two lists then fails loudly instead of
 * producing an order with holes in it.
 *
 * Non-module references come in three shapes, each a rule rather than an
 * inventory: a stylesheet's `@import` (resolved against the stylesheet, as a
 * browser does), a host page's `<link href>`/`<script src>` (only the ones
 * written against the deploy's own `{{CORA_BASE}}` token — anything else is a
 * SharePoint-owned asset the deploy neither ships nor can check), and the
 * runtime edge from a Case Type module to the Question Bank artifact it awaits,
 * which `verify-config.js` hands over because it already resolves that path.
 *
 * Once the graph is clean, `verify-config.js` evaluates the configuration on top
 * of it — Case Type modules, Question Bank artifacts and the route table — for
 * the reasons its own header gives.
 */

import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  filesUnder,
  importSpecifiers,
  resolveRelative,
} from './module-graph.js';
import { checkConfiguration } from './verify-config.js';

const execFileAsync = promisify(execFile);

/** Where the dependency-graph artifact is written. */
const GRAPH_PATH = '.verify/import-graph.json';

/**
 * Artifact schema version. Bump it when a consumer would misread the old shape;
 * the deploy refuses a version it was not written against.
 */
const GRAPH_VERSION = 2;

/**
 * Which files the deploy uploads, mirroring the deploy script's own constants.
 * Recorded in the artifact so the deploy can assert the two agree.
 */
const DEPLOYABLE = Object.freeze({
  includeRoots: ['src', 'case-types', 'host'],
  includeSuffixes: ['.js', '.css', '.html', '.aspx'],
  // Question Bank artifacts are JSON in .txt files, and only in this one
  // directory — a stray .txt elsewhere is a tool artefact, not runtime content.
  bankDir: 'case-types/banks',
  bankSuffix: '.txt',
});

/** Host-page references the deploy owns start with this token. */
const HOST_BASE_TOKEN = '{{CORA_BASE}}/';

/** A URL a stylesheet or host page reaches that this repository does not host. */
const NOT_OURS = /^(?:[a-z][a-z0-9+.-]*:|\/)/i;

const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const CSS_IMPORT_URL = /@import\s+url\(\s*(['"]?)([^'")\n]+?)\1\s*\)/g;
const CSS_IMPORT_PLAIN = /@import\s+(['"])([^'"\n]+)\1/g;
// `[^>]*?` spans newlines, because the host page wraps a tag's attributes.
const HTML_LINK_HREF = /<link\b[^>]*?\shref\s*=\s*(['"])([^'"\n]+)\1/g;
const HTML_SCRIPT_SRC = /<script\b[^>]*?\ssrc\s*=\s*(['"])([^'"\n]+)\1/g;

/**
 * @typedef {{
 *   kind: 'syntax' | 'unresolved' | 'case-type' | 'bank' | 'route',
 *   file: string,
 *   specifier?: string,
 *   line?: number,
 *   message: string
 * }} Failure
 */
/**
 * How a file reaches another file. The import kinds come from the module
 * scanner; the rest are the non-module reference shapes, which are edges for
 * upload-ordering purposes but are not imports.
 * @typedef {import('./module-graph.js').ImportKind
 *   | 'css-import' | 'html-ref' | 'bank'} EdgeKind
 */
/**
 * @typedef {{
 *   specifier: string,
 *   resolved: string | null,
 *   kind: EdgeKind,
 *   line?: number
 * }} GraphEdge
 */
/**
 * A reference that is neither an import nor written in a module: already
 * resolved, because each shape resolves by its own rule.
 * @typedef {{
 *   specifier: string,
 *   resolved: string,
 *   kind: 'css-import' | 'html-ref' | 'bank',
 *   line?: number
 * }} AssetReference
 */
/**
 * @typedef {{
 *   version: number,
 *   deployable: typeof DEPLOYABLE,
 *   nodes: Record<string, { imports: GraphEdge[] }>,
 *   external: string[]
 * }} Graph
 */

/**
 * Parse every file the way Node will.
 *
 * @param {string[]} files repo-relative paths
 * @param {URL} root
 * @returns {Promise<Failure[]>}
 */
export async function checkSyntax(files, root) {
  /** @type {Failure[]} */
  const failures = [];
  for (const file of files) {
    try {
      await execFileAsync(process.execPath, [
        '--check',
        fileURLToPath(new URL(file, root)),
      ]);
    } catch (error) {
      failures.push({
        kind: 'syntax',
        file,
        message: firstErrorLine(error),
      });
    }
  }
  return failures;
}

/**
 * The most useful line of a failed `node --check`: the `SyntaxError: …` line if
 * there is one, otherwise whatever the process said.
 * @param {unknown} error @returns {string}
 */
function firstErrorLine(error) {
  const stderr = String(
    /** @type {{ stderr?: unknown }} */ (error)?.stderr ?? error
  ).trim();
  const syntaxError = stderr.split('\n').find((line) => /Error:/.test(line));
  return (syntaxError ?? stderr.split('\n')[0] ?? 'failed to parse').trim();
}

/**
 * Every file the deploy uploads, as repo-relative paths.
 *
 * @param {URL} root
 * @returns {string[]}
 */
export function deployableFiles(root) {
  return DEPLOYABLE.includeRoots
    .flatMap((includeRoot) => {
      // An include root a checkout does not have contributes nothing rather
      // than failing the gate: the deploy tolerates the same absence.
      try {
        return filesUnder(new URL(includeRoot + '/', root), root).filter(
          isDeployable
        );
      } catch {
        return [];
      }
    })
    .sort();
}

/**
 * @param {string} rel @returns {boolean}
 */
function isDeployable(rel) {
  const slash = rel.lastIndexOf('/');
  const dot = rel.lastIndexOf('.');
  const suffix = dot > slash ? rel.slice(dot) : '';
  if (DEPLOYABLE.includeSuffixes.includes(suffix)) return true;
  return (
    suffix === DEPLOYABLE.bankSuffix &&
    rel.slice(0, slash) === DEPLOYABLE.bankDir
  );
}

/**
 * Every reference a non-module deployed file makes to another deployed file.
 * Each shape carries its own resolution rule, so the target is resolved here
 * rather than by the caller.
 *
 * @param {string} rel repo-relative path
 * @param {URL} root
 * @returns {AssetReference[]}
 */
export function assetReferences(rel, root) {
  if (rel.endsWith('.css')) return stylesheetImports(rel, root);
  if (rel.endsWith('.html') || rel.endsWith('.aspx')) {
    return hostPageReferences(rel, root);
  }
  return [];
}

/**
 * `@import` targets, resolved against the stylesheet's own URL the way a
 * browser resolves them — which is also why a specifier with no leading `./`
 * still resolves, unlike a module specifier.
 * @param {string} rel @param {URL} root @returns {AssetReference[]}
 */
function stylesheetImports(rel, root) {
  const code = withoutComments(rel, root, CSS_COMMENT);
  /** @type {AssetReference[]} */
  const references = [];
  for (const re of [CSS_IMPORT_URL, CSS_IMPORT_PLAIN]) {
    for (const match of code.matchAll(re)) {
      const specifier = match[2];
      if (NOT_OURS.test(specifier)) continue;
      const resolved = resolveRelative(
        rel,
        specifier.startsWith('.') ? specifier : './' + specifier,
        root
      );
      if (resolved === null) continue;
      references.push({
        specifier,
        resolved,
        kind: 'css-import',
        line: lineOf(code, match.index),
      });
    }
  }
  return references.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

/**
 * Stylesheet and script references a host page makes, which are edges only when
 * they are written against the deploy's own base token: the page legitimately
 * also references SharePoint-owned assets, which this repository neither ships
 * nor can resolve. The token's remainder is repo-root-relative, because the
 * token expands to the root of the uploaded tree.
 * @param {string} rel @param {URL} root @returns {AssetReference[]}
 */
function hostPageReferences(rel, root) {
  const code = withoutComments(rel, root, HTML_COMMENT);
  /** @type {AssetReference[]} */
  const references = [];
  for (const re of [HTML_LINK_HREF, HTML_SCRIPT_SRC]) {
    for (const match of code.matchAll(re)) {
      const specifier = match[2];
      if (!specifier.startsWith(HOST_BASE_TOKEN)) continue;
      references.push({
        specifier,
        resolved: specifier.slice(HOST_BASE_TOKEN.length).replace(/^\/+/, ''),
        kind: 'html-ref',
        line: lineOf(code, match.index),
      });
    }
  }
  return references.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

/**
 * A file's text with its comments blanked out — a commented-out reference is not
 * a reference. Every newline survives, so a match index still maps to the line a
 * reader will look at.
 * @param {string} rel @param {URL} root @param {RegExp} comment
 * @returns {string}
 */
function withoutComments(rel, root, comment) {
  return readFileSync(new URL(rel, root), 'utf8').replace(comment, (text) =>
    text.replace(/[^\n]/g, ' ')
  );
}

/**
 * 1-based line number of a match index.
 * @param {string} text @param {number} index @returns {number}
 */
function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * Attach edges another checker resolved — today the Case Type to Question Bank
 * artifact edges — to the graph, checking each target exists under the exact
 * spelling given. An edge whose source file is not deployed is dropped: nothing
 * uploads it, so it constrains no upload order.
 *
 * @param {Graph} graph mutated in place
 * @param {(AssetReference & { from: string })[]} edges
 * @param {URL} root
 * @returns {Failure[]}
 */
export function attachDerivedEdges(graph, edges, root) {
  const entriesOf = directoryReader(root);
  /** @type {Failure[]} */
  const failures = [];
  for (const { from, specifier, resolved, kind } of edges) {
    const node = graph.nodes[from];
    if (!node) continue;
    const problem = describeMissing(resolved, entriesOf);
    if (problem) {
      failures.push({
        kind: 'unresolved',
        file: from,
        specifier,
        message: problem,
      });
      continue;
    }
    node.imports.push({ specifier, resolved, kind });
  }
  return failures;
}

/**
 * Resolve every reference in every file, collecting the dependency graph and
 * the references that do not resolve.
 *
 * @param {string[]} files repo-relative paths
 * @param {URL} root
 * @returns {{ graph: Graph, failures: Failure[] }}
 */
export function buildGraph(files, root) {
  const entriesOf = directoryReader(root);
  /** @type {Failure[]} */
  const failures = [];
  /** @type {Graph['nodes']} */
  const nodes = {};
  /** @type {Set<string>} */
  const external = new Set();

  for (const file of [...files].sort()) {
    /** @type {GraphEdge[]} */
    const imports = [];
    if (!file.endsWith('.js')) {
      for (const reference of assetReferences(file, root)) {
        const problem = describeMissing(reference.resolved, entriesOf);
        if (problem) {
          failures.push({
            kind: 'unresolved',
            file,
            specifier: reference.specifier,
            line: reference.line,
            message: problem,
          });
          continue;
        }
        imports.push(reference);
      }
      nodes[file] = { imports };
      continue;
    }
    for (const { specifier, kind, line } of importSpecifiers(file, root)) {
      if (specifier.startsWith('node:')) {
        external.add(specifier);
        imports.push({ specifier, resolved: null, kind, line });
        continue;
      }
      const resolved = resolveRelative(file, specifier, root);
      if (resolved === null) {
        failures.push({
          kind: 'unresolved',
          file,
          specifier,
          line,
          message:
            'not a relative path or a node: built-in — this project has no runtime dependencies',
        });
        continue;
      }
      const problem = describeMissing(resolved, entriesOf);
      if (problem) {
        failures.push({
          kind: 'unresolved',
          file,
          specifier,
          line,
          message: problem,
        });
        continue;
      }
      imports.push({ specifier, resolved, kind, line });
    }
    nodes[file] = { imports };
  }

  return {
    graph: {
      version: GRAPH_VERSION,
      deployable: DEPLOYABLE,
      nodes,
      external: [...external].sort(),
    },
    failures,
  };
}

/**
 * @typedef {{ names: Set<string>, directories: Set<string> }} Entries
 */

/**
 * Memoised, case-exact directory listing, so a repo-wide run reads each
 * directory once.
 * @param {URL} root @returns {(dirRel: string) => Entries}
 */
function directoryReader(root) {
  /** @type {Map<string, Entries>} */
  const cache = new Map();
  return (dirRel) => {
    const cached = cache.get(dirRel);
    if (cached) return cached;
    /** @type {Entries} */
    const entries = { names: new Set(), directories: new Set() };
    try {
      for (const entry of readdirSync(new URL(dirRel, root), {
        withFileTypes: true,
      })) {
        entries.names.add(entry.name);
        if (entry.isDirectory()) entries.directories.add(entry.name);
      }
    } catch {
      // Not a directory, or not there: every segment under it is missing.
    }
    cache.set(dirRel, entries);
    return entries;
  };
}

/**
 * Why a repo-relative path is not on disk under the exact spelling given, or
 * null when it is. Walks segment by segment so the wrong case is reported as
 * the wrong case rather than as a missing file.
 *
 * @param {string} rel
 * @param {(dirRel: string) => Entries} entriesOf
 * @returns {string | null}
 */
function describeMissing(rel, entriesOf) {
  const segments = rel.split('/');
  let dir = '';
  for (const [index, segment] of segments.entries()) {
    const { names, directories } = entriesOf(dir);
    const isLast = index === segments.length - 1;
    if (names.has(segment)) {
      if (isLast && directories.has(segment)) {
        return `resolves to the directory ${dir}${segment}, not a file — there is no directory-index resolution in a browser`;
      }
      dir += segment + '/';
      continue;
    }
    const onDisk = [...names].find(
      (entry) => entry.toLowerCase() === segment.toLowerCase()
    );
    const what = isLast ? 'file' : 'directory';
    return onDisk
      ? `case mismatch: resolves to ${dir}${segment} but the ${what} on disk is named ${onDisk}`
      : `no such ${what}: ${dir}${segment}`;
  }
  return null;
}

/**
 * @param {Failure} failure @returns {string}
 */
function formatFailure(failure) {
  const where = failure.line ? `${failure.file}:${failure.line}` : failure.file;
  const what = failure.specifier ? ` '${failure.specifier}'` : '';
  return `${failure.kind.toUpperCase()} ${where}${what} — ${failure.message}`;
}

async function main() {
  const root = new URL('../', import.meta.url);
  const files = deployableFiles(root);

  const syntaxFailures = await checkSyntax(
    files.filter((file) => file.endsWith('.js')),
    root
  );
  const { graph, failures: graphFailures } = buildGraph(files, root);
  const failures = [...syntaxFailures, ...graphFailures];

  if (failures.length) {
    for (const failure of failures) console.error(formatFailure(failure));
    console.error(
      `verify: ${failures.length} failure(s) — graph not written, since a graph missing its broken edges is worse than no graph`
    );
    // Importing Case Type modules or the route table out of a tree that does
    // not parse or does not resolve produces derivative errors, not new
    // information. Fix the graph, then run again.
    console.error(
      'verify: configuration checks skipped until the module graph is clean'
    );
    process.exitCode = 1;
    return;
  }

  const {
    failures: configFailures,
    counts,
    bankEdges,
  } = await checkConfiguration();
  const remaining = [
    ...configFailures,
    ...attachDerivedEdges(graph, bankEdges, root),
  ];
  if (remaining.length) {
    for (const failure of remaining) console.error(formatFailure(failure));
    console.error(
      `verify: ${remaining.length} configuration failure(s) — graph not written`
    );
    process.exitCode = 1;
    return;
  }

  mkdirSync(new URL('.verify/', root), { recursive: true });
  writeFileSync(
    new URL(GRAPH_PATH, root),
    JSON.stringify(graph, null, 2) + '\n',
    'utf8'
  );

  const edges = Object.values(graph.nodes).reduce(
    (total, node) => total + node.imports.length,
    0
  );
  console.log(
    `verify: ${files.length} deployable files, ${edges} edges, ${graph.external.length} external — graph written to ${GRAPH_PATH}`
  );
  console.log(
    `verify: config clean — ${counts.caseTypes} Case Type(s), ${counts.banks} bank artifact(s), ${counts.routes} route(s) checked`
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
