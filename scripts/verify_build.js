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
 * Scope for the graph is `src/` and `case-types/` `.js` files. Once it is clean,
 * `verify-config.js` evaluates the configuration on top of it — Case Type
 * modules, Question Bank artifacts and the route table — for the reasons its own
 * header gives. Checking asset references from the host page and CSS is still a
 * separate concern and is not done here.
 */

import { execFile } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  importSpecifiers,
  jsFilesUnder,
  resolveRelative,
} from './module-graph.js';
import { checkConfiguration } from './verify-config.js';

const execFileAsync = promisify(execFile);

/** Where the dependency-graph artifact is written. */
const GRAPH_PATH = '.verify/import-graph.json';

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
 * @typedef {{
 *   specifier: string,
 *   resolved: string | null,
 *   kind: import('./module-graph.js').ImportKind,
 *   line: number
 * }} GraphEdge
 */
/**
 * @typedef {{
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
 * Resolve every import in every file, collecting the dependency graph and the
 * specifiers that do not resolve.
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
    graph: { nodes, external: [...external].sort() },
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
  const files = [
    ...jsFilesUnder(new URL('src/', root), root),
    ...jsFilesUnder(new URL('case-types/', root), root),
  ].sort();

  const syntaxFailures = await checkSyntax(files, root);
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

  const { failures: configFailures, counts } = await checkConfiguration();
  if (configFailures.length) {
    for (const failure of configFailures) console.error(formatFailure(failure));
    console.error(
      `verify: ${configFailures.length} configuration failure(s) — graph not written`
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
    `verify: ${files.length} modules, ${edges} import edges, ${graph.external.length} external — graph written to ${GRAPH_PATH}`
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
