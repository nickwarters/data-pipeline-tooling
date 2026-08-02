// @ts-check

/**
 * Dead-code checks for the verify gate: the inverse of the question the graph
 * already answers.
 *
 * Building the graph asks "does every specifier resolve?" — it walks outward
 * from each file and complains about a reference with nothing behind it. This
 * asks the other direction: is there anything in front of each file, and in
 * front of each name it exports? Nothing else in the toolchain can answer that.
 * tsc is happy to type-check a module nobody loads, and the coverage floor is
 * actively unhelpful here, because dead code arrives with its own tests and so
 * raises coverage rather than lowering it.
 *
 * Reachability is computed over the already-built graph plus two supplements:
 * JSDoc type edges, which the graph deliberately excludes because they load
 * nothing at runtime but which are real readers of a typedef-only module, and
 * the roots outside the deployed tree — the tools under `scripts/` and the
 * mock-first dev loop under `dev/`, neither of which the deploy uploads but
 * both of which are production consumers in the sense that matters here.
 */

import { existsSync } from 'node:fs';

import {
  exportedNames,
  filesUnder,
  importedNames,
  importSpecifiers,
  readCode,
  resolveRelative,
  typeReferences,
} from './module-graph.js';

/** @typedef {import('./verify_build.js').Failure} Failure */
/** @typedef {import('./verify_build.js').Graph} Graph */

/**
 * Exports with no production consumer that are nonetheless kept, keyed by file
 * and then by export name, each carrying its own one-line reason.
 *
 * An entry belongs here only when the name is genuinely reachable from outside
 * this repository's own code — a seam a host page, a deploy step or an operator
 * calls into — so "a test needs it" is never a reason. Write the reason in your
 * own words: it has to read to whoever finds the entry stale.
 *
 * Empty is the healthy state, and it is where this list starts.
 *
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
const PUBLIC_SEAMS = Object.freeze({});

/** Where the deployed tree's own entry points live: nothing imports a host page. */
const HOST_SUFFIXES = ['.html', '.aspx'];

/** Directories whose modules are checked for being dead. */
const CHECKED_ROOTS = ['src/', 'case-types/'];

/**
 * Directories that are roots rather than checked subjects: tools and the dev
 * loop are not deployed, so they are never dead in the sense this gate means,
 * but what they import is alive.
 */
const TOOL_ROOTS = ['scripts/', 'dev/'];

/** What under a tool root can carry an ES import: a module, or an inline one. */
const ROOT_SUFFIXES = ['.js', '.html'];

/**
 * The walk stops here. A test is not a consumer — a module kept alive only by
 * the tests written for it is exactly what this gate exists to find — and the
 * flow harness under `tests/` is reachable from `scripts/`, so without this the
 * tooling would launder a dead module back into the reachable set.
 */
const NOT_A_CONSUMER = 'tests/';

/**
 * Phase one of the export check: report only a name that appears nowhere at
 * all, not even inside the module that declares it. The identifier occurring
 * exactly once in that module's own code means the `export` line is its only
 * mention.
 *
 * The larger population — a name exported purely so a test can reach it, while
 * its only real caller is a line further down the same file — is deliberately
 * left for a later change, because unwinding it is a judgement call about test
 * seams per case rather than a mechanical deletion.
 *
 * The failure mode is conservative in the safe direction: a name that also
 * happens to appear in a string literal in its own file suppresses its own
 * report. That can hide dead code; it can never condemn live code.
 *
 * The name goes into the pattern unescaped because every name reaching here is
 * a JavaScript identifier, which carries no regular expression metacharacter.
 *
 * @param {string} name @param {string} code @returns {boolean}
 */
function referencedNowhereAtAll(name, code) {
  const occurrences = code.match(
    new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g')
  );
  return (occurrences?.length ?? 0) <= 1;
}

/**
 * Every module the deployed tree, the tools and the dev loop can actually
 * reach, and which names each reached module is read for.
 *
 * Roots are declared rather than inferred: the host pages, which nothing
 * imports, plus everything under the tool roots that can carry an import. The
 * route table's page entries are deliberately NOT roots — a page is a static
 * import on its route entry, so it is reached transitively from `src/app.js`,
 * and listing pages here would paper over the day that stops being true. If it
 * does stop being true the gate fails loudly, which is the direction worth
 * having.
 *
 * A tool root contributes its `.html` as well as its `.js`, because an inline
 * `<script type="module">` reads modules just as a `.js` file does and the
 * static import scanner finds those imports in either. A page whose only script
 * reference is a `<script src>` tag contributes nothing, since a tag reference
 * is not an ES import.
 *
 * @param {URL} root @param {Graph} graph
 * @returns {{ reachable: Set<string>, consumed: Map<string, Set<string>> }}
 */
function reachableModules(root, graph) {
  /** @type {Set<string>} */
  const reachable = new Set();
  /** @type {Map<string, Set<string>>} */
  const consumed = new Map();

  /** @param {string | null} target @param {string[] | '*'} names */
  const record = (target, names) => {
    if (target === null) return;
    const into = consumed.get(target) ?? new Set();
    for (const name of names === '*' ? ['*'] : names) into.add(name);
    consumed.set(target, into);
  };

  /** @type {string[]} */
  const queue = [];
  for (const file of Object.keys(graph.nodes)) {
    if (HOST_SUFFIXES.some((suffix) => file.endsWith(suffix))) queue.push(file);
  }
  for (const toolRoot of TOOL_ROOTS) {
    // A tree without a tool root contributes no roots rather than failing:
    // the deployable scan tolerates the same absence for the same reason.
    try {
      queue.push(
        ...filesUnder(new URL(toolRoot, root), root).filter((rel) =>
          ROOT_SUFFIXES.some((suffix) => rel.endsWith(suffix))
        )
      );
    } catch {
      // no tool root, no roots from it
    }
  }

  while (queue.length) {
    const file = queue.pop();
    if (file === undefined) continue;
    if (reachable.has(file) || file.startsWith(NOT_A_CONSUMER)) continue;
    // `resolveRelative` computes a path; it does not check that anything is
    // there. Two kinds of queue entry can therefore point at nothing: a
    // specifier written in prose inside a comment, which resolves like any
    // other because reading comments is the price typeReferences pays, and a
    // broken relative specifier in a tool or a dev fixture, which is outside
    // the deployed graph and so has never been resolved by anyone. Neither
    // deserves an ENOENT thrown out of the gate. Whether a DEPLOYED specifier
    // really is on disk, spelled exactly, is the graph builder's question, and
    // it has already answered it before this runs.
    if (!existsSync(new URL(file, root))) continue;
    reachable.add(file);

    // Reaching a file and reading a name off it are separate facts: a
    // side-effect import, a stylesheet `@import` and a `<script src>` all make
    // their target reachable while consuming none of its exports.
    for (const target of targetsOf(file, root, graph)) queue.push(target);
    if (!file.endsWith('.js') && !file.endsWith('.html')) continue;
    for (const { specifier, names } of importedNames(file, root)) {
      record(resolveRelative(file, specifier, root), names);
    }
    for (const { specifier, name } of typeReferences(file, root)) {
      const target = resolveRelative(file, specifier, root);
      record(target, [name]);
      if (target !== null) queue.push(target);
    }
  }

  return { reachable, consumed };
}

/**
 * Files a file reaches. Graph nodes already carry their resolved edges,
 * including the non-module ones; anything outside the graph — a tool, a dev
 * fixture, the styleguide — is scanned here.
 *
 * @param {string} file @param {URL} root @param {Graph} graph
 * @returns {string[]}
 */
function targetsOf(file, root, graph) {
  const node = graph.nodes[file];
  if (node) {
    return node.imports
      .map((edge) => edge.resolved)
      .filter((resolved) => resolved !== null);
  }
  return importSpecifiers(file, root)
    .map(({ specifier }) => resolveRelative(file, specifier, root))
    .filter((resolved) => resolved !== null);
}

/**
 * Modules under the checked roots that nothing reaches.
 *
 * @param {URL} root @param {Graph} graph @param {Set<string>} reachable
 * @returns {Failure[]}
 */
function unreachableModules(root, graph, reachable) {
  return checkedModules(graph)
    .filter((file) => !reachable.has(file))
    .map((file) => ({
      kind: /** @type {const} */ ('unreachable'),
      file,
      message:
        'nothing imports this module, and no host page, tool or dev fixture reaches it — delete it, or import it from whatever was meant to use it',
    }));
}

/**
 * Exported names under the checked roots that nothing reads.
 *
 * A module already reported unreachable is skipped: deleting a page should read
 * as one failure, not as one failure plus one per name it exported.
 *
 * @param {URL} root @param {Graph} graph @param {Set<string>} reachable
 * @param {Map<string, Set<string>>} consumed
 * @param {typeof PUBLIC_SEAMS} exemptions
 * @returns {Failure[]}
 */
function unreferencedExports(root, graph, reachable, consumed, exemptions) {
  /** @type {Failure[]} */
  const failures = [];
  for (const file of checkedModules(graph)) {
    if (!reachable.has(file)) continue;
    const readFor = consumed.get(file) ?? new Set();
    if (readFor.has('*')) continue;
    const code = readCode(file, root);
    for (const { name, line } of exportedNames(file, root)) {
      if (readFor.has(name)) continue;
      if (exemptions[file]?.[name]) continue;
      if (!referencedNowhereAtAll(name, code)) continue;
      failures.push({
        kind: 'unused-export',
        file,
        line,
        message: `'${name}' is exported but read by nothing — delete it, or add an entry to PUBLIC_SEAMS saying why it stays`,
      });
    }
  }
  return failures;
}

/**
 * Exemption entries that have stopped buying anything: the file or the export
 * is gone, or the export now has a real consumer. An exemption is a claim about
 * the code, and a claim nobody checks rots.
 *
 * @param {URL} root @param {Graph} graph @param {Map<string, Set<string>>} consumed
 * @param {typeof PUBLIC_SEAMS} exemptions
 * @returns {Failure[]}
 */
function staleExemptions(root, graph, consumed, exemptions) {
  const modules = new Set(checkedModules(graph));
  /** @type {Failure[]} */
  const failures = [];
  for (const [file, names] of Object.entries(exemptions)) {
    const declared = modules.has(file)
      ? new Set(exportedNames(file, root).map((entry) => entry.name))
      : null;
    for (const name of Object.keys(names)) {
      if (declared === null || !declared.has(name)) {
        failures.push({
          kind: 'unused-export',
          file,
          message: `the exemption for '${name}' names something that no longer exists — delete the entry`,
        });
        continue;
      }
      const readFor = consumed.get(file) ?? new Set();
      if (readFor.has('*') || readFor.has(name)) {
        failures.push({
          kind: 'unused-export',
          file,
          message: `'${name}' has a consumer now, so its exemption is no longer buying anything — delete the entry`,
        });
      }
    }
  }
  return failures;
}

/**
 * Deployed modules under the checked roots, which are the only files this gate
 * calls dead: a tool or a dev fixture is nobody's dependency by design.
 * @param {Graph} graph @returns {string[]}
 */
function checkedModules(graph) {
  return Object.keys(graph.nodes)
    .filter((file) => file.endsWith('.js'))
    .filter((file) => CHECKED_ROOTS.some((dir) => file.startsWith(dir)))
    .sort();
}

/**
 * Every dead-code check, over an already-clean graph, plus what it covered.
 *
 * The graph is an argument rather than something rebuilt here: it is expensive,
 * the caller has already proved it resolves, and importing the builder would
 * close a cycle between the two halves of the gate.
 *
 * @param {{ root: URL, graph: Graph, exemptions?: typeof PUBLIC_SEAMS }} options
 * @returns {{
 *   failures: Failure[],
 *   counts: { reachable: number, exports: number, exempt: number }
 * }}
 */
export function checkDeadCode({ root, graph, exemptions = PUBLIC_SEAMS }) {
  const { reachable, consumed } = reachableModules(root, graph);
  const unreachable = unreachableModules(root, graph, reachable);
  const failures = [
    ...unreachable,
    ...unreferencedExports(root, graph, reachable, consumed, exemptions),
    ...staleExemptions(root, graph, consumed, exemptions),
  ];
  const live = checkedModules(graph).filter((file) => reachable.has(file));
  return {
    failures,
    counts: {
      reachable: live.length,
      exports: live.reduce(
        (total, file) => total + exportedNames(file, root).length,
        0
      ),
      exempt: Object.values(exemptions).reduce(
        (total, names) => total + Object.keys(names).length,
        0
      ),
    },
  };
}
