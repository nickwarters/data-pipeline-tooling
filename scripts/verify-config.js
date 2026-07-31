// @ts-check

/**
 * Configuration checks for the verify gate: evaluate the things the browser
 * would otherwise be the first to evaluate — Case Type modules, Question Bank
 * artifacts, and the route table — and report what is broken by slug, file and
 * route name.
 *
 * The point is where a defect is discovered, not whether it is survivable. A
 * Case Type that throws is still contained at boot and still named in the
 * unavailable-Case-Type banner; that stays the backstop for the gap between a
 * deploy and a load, because an artifact hosted in SharePoint can be edited,
 * moved or served badly long after the last verify run. What changes is that a
 * maintainer running the gate sees the same failure first, with the slug in the
 * message, instead of reading it out of a browser console.
 */

import { readFileSync, readdirSync } from 'node:fs';

import {
  detectCycles,
  showWhenReferences,
} from '../src/evaluators/applicability-evaluator.js';
import { sectionIds } from '../src/lib/section-registry.js';
import { ROLES } from '../src/services/section-access.js';
import { CASE_TYPES, loadCaseTypeConfig } from '../case-types/manifest.js';
import { resolveRelative } from './module-graph.js';

/** @typedef {import('./verify_build.js').Failure} Failure */
/** @typedef {import('../case-types/manifest.js').CaseTypeEntry} CaseTypeEntry */

const REPO_ROOT = new URL('../', import.meta.url);

/** The module whose relative specifiers the registry thunks are written against. */
const MANIFEST = 'case-types/manifest.js';
/** The file every route failure is attributed to — the route table lives there. */
const ROUTES = 'src/setup/register-routes.js';
const BANKS_DIR = 'case-types/banks/';

/** The response types a Question Definition may declare. */
const RESPONSE_TYPES = [
  'yes-no-na',
  'single-choice',
  'multi-choice',
  'outcome',
];

/**
 * Every configuration check, over the real repository, plus what each one
 * covered — so the gate's success line can say how much it actually looked at.
 *
 * Also hands back the Case Type to Question Bank artifact edges, because
 * resolving a registry `bank` thunk to a file on disk already happens here and
 * one resolution is better than a second pattern match somewhere else.
 *
 * @returns {Promise<{
 *   failures: Failure[],
 *   bankEdges: BankEdge[],
 *   counts: { caseTypes: number, banks: number, routes: number }
 * }>}
 */
export async function checkConfiguration() {
  const artifacts = bankArtifacts();

  /** @type {Record<string, import('../src/setup/register-routes.js').RouteEntry> | null} */
  let table = null;
  /** @type {Failure[]} */
  let routeFailures = [];
  // Reached through an import() inside a try/catch because the table imports
  // every page module it holds: a page that will not evaluate must be a
  // reported failure, not the thing that stops the gate reporting.
  try {
    const { routeTable } = await import('../src/setup/register-routes.js');
    table = routeTable(/** @type {any} */ ({ journeyCaseSources: [] }));
  } catch (error) {
    routeFailures = [
      {
        kind: 'route',
        file: ROUTES,
        message: `the route table could not be built — ${messageOf(error)}`,
      },
    ];
  }

  const failures = [
    ...(await checkCaseTypes()),
    ...checkBankArtifacts({ artifacts }),
    ...(table ? checkRouteTable({ table }) : routeFailures),
  ];
  return {
    failures,
    bankEdges: bankArtifactEdges(),
    counts: {
      caseTypes: CASE_TYPES.length,
      banks: artifacts.length,
      routes: Object.keys(table ?? {}).length,
    },
  };
}

/**
 * The first quoted string in a thunk's source, which is the module specifier or
 * artifact path it reaches for.
 *
 * Reading a function's source is sound here because the deployed bytes are the
 * authored bytes: no tool minifies, transpiles or rewrites these files, so the
 * literal in the source is the literal the browser will request. A thunk that
 * builds its path from a variable yields null; the bank check reports that as a
 * failure rather than skipping it, because an unreadable thunk is an unchecked
 * one, which is a result worth saying out loud.
 *
 * @param {unknown} thunk
 * @returns {string | null}
 */
export function literalPathOf(thunk) {
  const match = /['"]([^'"\n]+)['"]/.exec(String(thunk));
  return match ? match[1] : null;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Evaluate every Case Type module and check the config it produces.
 *
 * Deliberately iterates the registry itself rather than going through
 * `resolveAppCaseSources`: that returns eligibility-filtered `CaseSource`
 * records, which carry no `config` to inspect, and asking it would tie the gate
 * to the SharePoint group-name vocabulary for no gain. The two cheap checks it
 * performs on the way — an explicit `listName`, a resolvable display name — are
 * repeated here instead.
 *
 * @param {{ caseTypes?: readonly CaseTypeEntry[] }} [options]
 * @returns {Promise<Failure[]>}
 */
export async function checkCaseTypes(options = {}) {
  const caseTypes = options.caseTypes ?? CASE_TYPES;

  /** @type {Failure[]} */
  const failures = [];
  for (const entry of caseTypes) {
    const file = caseTypeFile(entry);
    /** @param {string} message */
    const fail = (message) =>
      failures.push({
        kind: 'case-type',
        file,
        message: `Case Type "${entry.slug}": ${message}`,
      });

    /** @type {any} */
    let config;
    try {
      config = await loadCaseTypeConfig(entry.slug, {
        [entry.slug]: entry.importer,
      });
    } catch (error) {
      fail(`failed to load — ${messageOf(error)}`);
      continue;
    }

    if (typeof config?.computeOutcome !== 'function') {
      fail(
        'must export a `computeOutcome` function — the Outcome is code, not a descriptor'
      );
    }
    if (!isNonEmptyString(config?.listName)) {
      fail(
        'declares no `listName`; every Case Type must name the SharePoint list its Cases live on'
      );
    }
    if (!isNonEmptyString(entry.displayName)) {
      fail(
        'has no registry `displayName`, which composes its three SharePoint group names'
      );
    }

    failures.push(...checkQuestions(entry.slug, file, config));
    failures.push(...checkSections(entry.slug, file, config));
    failures.push(...checkRemediationStatuses(entry.slug, file, config));
  }
  return failures;
}

/**
 * The module a registry entry points at, for the failure line. Falls back to
 * the manifest, which is where an unreadable importer thunk is written.
 *
 * @param {CaseTypeEntry} entry
 * @returns {string}
 */
function caseTypeFile(entry) {
  const specifier = literalPathOf(entry.importer);
  const resolved = specifier
    ? resolveRelative(MANIFEST, specifier, REPO_ROOT)
    : null;
  return resolved ?? MANIFEST;
}

/**
 * @param {string} slug
 * @param {string} file
 * @param {any} config
 * @returns {Failure[]}
 */
function checkQuestions(slug, file, config) {
  /** @type {Failure[]} */
  const failures = [];
  /** @param {string} message */
  const fail = (message) =>
    failures.push({
      kind: 'case-type',
      file,
      message: `Case Type "${slug}": ${message}`,
    });

  // Already known to be an array: `loadCaseTypeConfig` rejects anything else
  // before the caller gets here.
  const questions = config.questions;

  /** @type {Set<string>} */
  const ids = new Set();
  for (const question of questions) {
    const id = question?.id;
    if (!isNonEmptyString(id)) {
      fail('a Question Definition has no `id`');
      continue;
    }
    if (ids.has(id)) fail(`duplicate Question Definition id "${id}"`);
    ids.add(id);
  }

  const beforeShapeChecks = failures.length;
  for (const question of questions) {
    for (const problem of malformedNodes(question?.showWhen)) {
      fail(`question "${question.id}" has a showWhen ${problem}`);
    }
  }
  // Every check below walks the condition tree, and so does the evaluator that
  // will run it in the browser — a node that is not shaped like a condition
  // throws in all of them. Naming the Case Type and the question is the useful
  // outcome; crashing the gate with an anonymous type error is not.
  if (failures.length > beforeShapeChecks) return failures;

  // The full authored id set, deprecated definitions included: a Question
  // Definition is flagged rather than deleted, so a showWhen reference to a
  // deprecated one still resolves. Building this from the runtime catalogue,
  // which filters `deprecated` out, would report those as dangling.
  for (const question of questions) {
    for (const ref of showWhenReferences(question?.showWhen)) {
      if (!ids.has(ref)) {
        fail(
          `question "${question.id}" has a showWhen reference to unknown Question Definition id "${ref}"`
        );
      }
    }
  }

  for (const question of questions) {
    for (const keys of ignoredSiblingKeys(question?.showWhen)) {
      fail(
        `question "${question.id}" has a showWhen node holding ${keys} together — the evaluator stops at the first of \`$and\`/\`$or\` and ignores everything beside it`
      );
    }
  }

  if (detectCycles(questions)) {
    fail('its showWhen graph contains a cycle');
  }
  return failures;
}

/**
 * Every part of a condition that is not shaped like one: a node that is not a
 * plain object, or a `$and`/`$or` holding anything but an array. Forgetting the
 * brackets around a single-condition group is the natural slip here.
 *
 * Neither degrades gracefully. The evaluator asks `'$and' in node`, which throws
 * on a primitive, and calls `.every`/`.some` on a combinator's value, which
 * throws on anything but an array — so a slip in this shape is a crash on the
 * Case Review page, not a condition that merely misbehaves.
 *
 * A falsy `showWhen` is not a malformed condition: the evaluator treats an
 * absent one as "always applicable" and never looks inside it. Inside a
 * combinator array there is no such guard, so an element is checked whatever it
 * is.
 *
 * @param {unknown} cond
 * @returns {string[]} what is wrong, phrased to follow "has a showWhen"
 */
function malformedNodes(cond) {
  return cond ? nodeProblems(cond) : [];
}

/**
 * @param {unknown} node
 * @returns {string[]}
 */
function nodeProblems(node) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return [
      `holding ${describeNode(node)} where a condition object was expected`,
    ];
  }
  /** @type {string[]} */
  const problems = [];
  for (const key of ['$and', '$or']) {
    if (!(key in node)) continue;
    const value = /** @type {Record<string, unknown>} */ (node)[key];
    if (!Array.isArray(value)) {
      problems.push(`\`${key}\` that is not an array`);
      continue;
    }
    for (const child of value) problems.push(...nodeProblems(child));
  }
  return problems;
}

/**
 * @param {unknown} node
 * @returns {string}
 */
function describeNode(node) {
  if (Array.isArray(node)) return 'an array';
  if (node === null) return 'null';
  return `the ${typeof node} ${JSON.stringify(node) ?? String(node)}`;
}

/**
 * Every showWhen node that pairs a combinator with something else, as a
 * human-readable key list.
 *
 * The applicability evaluator tests for `$and`, then `$or`, and returns from
 * whichever it finds first — so a leaf key beside a combinator, or `$and` and
 * `$or` as siblings, silently does nothing at runtime. Authoring one reads as a
 * conjunction and behaves as if half of it were absent, which is exactly the
 * kind of quiet wrongness worth failing a gate on.
 *
 * @param {Record<string, unknown> | undefined} cond
 * @returns {string[]}
 */
function ignoredSiblingKeys(cond) {
  if (!cond || typeof cond !== 'object') return [];
  const keys = Object.keys(cond);
  const offenders =
    keys.length > 1 && keys.some((key) => key === '$and' || key === '$or')
      ? [keys.map((key) => `\`${key}\``).join(' and ')]
      : [];
  for (const key of ['$and', '$or']) {
    for (const child of /** @type {Record<string, unknown>[]} */ (
      cond[key] ?? []
    )) {
      offenders.push(...ignoredSiblingKeys(child));
    }
  }
  return offenders;
}

/**
 * @param {string} slug
 * @param {string} file
 * @param {any} config
 * @returns {Failure[]}
 */
function checkSections(slug, file, config) {
  const known = new Set(sectionIds());
  const knownRoles = new Set(ROLES);
  /** @param {string} message @returns {Failure} */
  const fail = (message) => ({
    kind: /** @type {const} */ ('case-type'),
    file,
    message,
  });
  return Object.entries(
    /** @type {Record<string, any>} */ (config?.sections ?? {})
  ).flatMap(([key, value]) => {
    if (!known.has(/** @type {any} */ (key))) {
      return [
        fail(
          `Case Type "${slug}": unknown \`sections\` key "${key}" — no such Case Review Section`
        ),
      ];
    }
    // The role vocabulary is closed and code-owned, so a typo in a Summary role
    // list would otherwise be silent: the block would simply be composed for
    // nobody holding that name, which is exactly what an unnamed role looks like.
    const showIn = value?.showInSummary;
    return Array.isArray(showIn)
      ? showIn
          .filter((r) => !knownRoles.has(r))
          .map((r) =>
            fail(
              `Case Type "${slug}": unknown role "${r}" in \`sections.${key}.showInSummary\``
            )
          )
      : [];
  });
}

/**
 * tsc catches the shape; these two are runtime-only: an empty list reads as
 * "offer none" and behaves as "offer all", and a list without `complete` leaves
 * every remediation row permanently unresolvable.
 *
 * @param {string} slug
 * @param {string} file
 * @param {any} config
 * @returns {Failure[]}
 */
function checkRemediationStatuses(slug, file, config) {
  const declared = config?.remediationStatuses;
  if (!Array.isArray(declared)) return [];
  if (declared.length === 0) {
    return [
      {
        kind: /** @type {const} */ ('case-type'),
        file,
        message: `Case Type "${slug}": declares an empty \`remediationStatuses\` — omit the key to offer every resolution`,
      },
    ];
  }
  if (!declared.includes('complete')) {
    return [
      {
        kind: /** @type {const} */ ('case-type'),
        file,
        message: `Case Type "${slug}": \`remediationStatuses\` omits "complete", so no remediation row could ever be resolved and no Case could ever complete`,
      },
    ];
  }
  return [];
}

/**
 * Check every Question Bank artifact on disk, then check that every registry
 * `bank` thunk names one that exists.
 *
 * The artifacts are found by scanning the directory rather than by walking the
 * registry, so an orphaned or half-renamed file is still parsed. The cross-check
 * runs one direction only — registry to disk — because the manifest explicitly
 * allows a Case Type registered before its bank artifact exists.
 *
 * @param {{
 *   artifacts?: string[],
 *   readText?: (rel: string) => string,
 *   caseTypes?: readonly CaseTypeEntry[]
 * }} [options]
 * @returns {Failure[]}
 */
export function checkBankArtifacts(options = {}) {
  const artifacts = options.artifacts ?? bankArtifacts();
  const readText =
    options.readText ??
    ((/** @type {string} */ rel) =>
      readFileSync(new URL(rel, REPO_ROOT), 'utf8'));
  const caseTypes = options.caseTypes ?? CASE_TYPES;

  /** @type {Failure[]} */
  const failures = [];
  for (const file of artifacts) {
    failures.push(...checkOneBank(file, readText));
  }

  const present = new Set(artifacts);
  for (const { slug, specifier, resolved } of registryBanks(caseTypes)) {
    if (specifier === null) {
      failures.push({
        kind: 'bank',
        file: MANIFEST,
        message: `Case Type "${slug}" declares a bank thunk with no literal artifact path, so the gate cannot check it`,
      });
      continue;
    }
    if (resolved === null || !present.has(resolved)) {
      failures.push({
        kind: 'bank',
        file: MANIFEST,
        message: `Case Type "${slug}" declares the Question Bank artifact '${resolved ?? specifier}', which is not on disk`,
      });
    }
  }
  return failures;
}

/**
 * @typedef {{
 *   from: string,
 *   specifier: string,
 *   resolved: string,
 *   kind: 'bank'
 * }} BankEdge
 */

/**
 * Where each registered Case Type's Question Bank artifact lives: the thunk's
 * literal specifier and what it resolves to, read once so the cross-check below
 * and the graph edge above it cannot disagree.
 *
 * @param {readonly CaseTypeEntry[]} caseTypes
 * @returns {{
 *   slug: string,
 *   module: string | null,
 *   specifier: string | null,
 *   resolved: string | null
 * }[]}
 */
function registryBanks(caseTypes) {
  return caseTypes
    .filter((entry) => entry.bank)
    .map((entry) => {
      const specifier = literalPathOf(entry.bank);
      const moduleSpecifier = literalPathOf(entry.importer);
      return {
        slug: entry.slug,
        module: moduleSpecifier
          ? resolveRelative(MANIFEST, moduleSpecifier, REPO_ROOT)
          : null,
        specifier,
        resolved: specifier
          ? resolveRelative(MANIFEST, specifier, REPO_ROOT)
          : null,
      };
    });
}

/**
 * The runtime data edge from a Case Type module to its Question Bank artifact.
 *
 * The edge starts at the Case Type module rather than the manifest because the
 * module awaits the artifact while it is being evaluated: a Case Type whose bank
 * is not uploaded yet throws, and boot contains that by dropping the Case Type,
 * which looks to a Reviewer like having no Cases. So the artifact has to be
 * uploaded first.
 *
 * A thunk the gate cannot read a literal path out of yields no edge; the
 * cross-check above already reports that, and reporting it twice would say
 * nothing new.
 *
 * @param {{ caseTypes?: readonly CaseTypeEntry[] }} [options]
 * @returns {BankEdge[]}
 */
export function bankArtifactEdges(options = {}) {
  /** @type {BankEdge[]} */
  const edges = [];
  for (const { module, specifier, resolved } of registryBanks(
    options.caseTypes ?? CASE_TYPES
  )) {
    if (module === null || specifier === null || resolved === null) continue;
    edges.push({ from: module, specifier, resolved, kind: 'bank' });
  }
  return edges;
}

/**
 * @returns {string[]}
 */
function bankArtifacts() {
  return readdirSync(new URL(BANKS_DIR, REPO_ROOT))
    .filter((name) => name.endsWith('.txt'))
    .sort()
    .map((name) => BANKS_DIR + name);
}

/**
 * @param {string} file
 * @param {(rel: string) => string} readText
 * @returns {Failure[]}
 */
function checkOneBank(file, readText) {
  /** @type {Failure[]} */
  const failures = [];
  /** @param {string} message */
  const fail = (message) => failures.push({ kind: 'bank', file, message });

  /** @type {any} */
  let bank;
  try {
    bank = JSON.parse(readText(file));
  } catch (error) {
    fail(`is not valid JSON — ${messageOf(error)}`);
    return failures;
  }

  if (bank === null || typeof bank !== 'object' || Array.isArray(bank)) {
    fail('does not hold a JSON object');
    return failures;
  }

  const expectedSlug = file.slice(file.lastIndexOf('/') + 1, -'.txt'.length);
  if (!isNonEmptyString(bank.slug)) {
    fail('declares no `slug`');
  } else if (bank.slug !== expectedSlug) {
    fail(
      `declares slug "${bank.slug}" but its filename says "${expectedSlug}" — the loader finds a bank by filename`
    );
  }
  if (!isNonEmptyString(bank.label)) fail('declares no `label`');

  if (!Array.isArray(bank.questions)) {
    fail('declares no `questions` array');
    return failures;
  }

  /** @type {Set<string>} */
  const ids = new Set();
  for (const question of bank.questions) {
    if (!isNonEmptyString(question?.id)) {
      fail('a question has no `id`');
      continue;
    }
    if (ids.has(question.id)) {
      fail(`duplicate question id "${question.id}"`);
    }
    ids.add(question.id);
    if (typeof question.text !== 'string') {
      fail(`question "${question.id}" has no \`text\``);
    }
    if (!RESPONSE_TYPES.includes(question.responseType)) {
      fail(
        `question "${question.id}" has responseType "${question.responseType}" — use one of: ${RESPONSE_TYPES.join(', ')}`
      );
    }
  }
  return failures;
}

/**
 * Check the route table: that every entry names exactly one page, the shape of
 * every hash pattern, and that no two entries claim the same one.
 *
 * A page reference pointing at a module that is not there needs no check here:
 * the module graph already resolves every specifier in that file case-exactly,
 * and these checks only run once it is clean.
 *
 * Not checked: pattern shadowing, where two distinct patterns both match one
 * hash and registration order silently decides the winner.
 *
 * @param {{
 *   table: Record<string, import('../src/setup/register-routes.js').RouteEntry>
 * }} options
 * @returns {Failure[]}
 */
export function checkRouteTable({ table }) {
  const entries = Object.entries(table);

  /** @type {Failure[]} */
  const failures = [];
  /** @param {string} message */
  const fail = (message) =>
    failures.push({ kind: 'route', file: ROUTES, message });

  /** @type {Map<string, string[]>} */
  const claimants = new Map();

  for (const [name, entry] of entries) {
    // The adapter takes exactly one page source and throws on anything else, so
    // a mis-shaped entry is a route that cannot mount. Caught here it is one
    // named line in the gate rather than a console error the first time
    // somebody navigates there.
    if (Boolean(entry.page) === Boolean(entry.load)) {
      fail(
        entry.page
          ? `route "${name}" declares both a \`page\` and a \`load\` thunk — one entry, one page`
          : `route "${name}" declares neither a \`page\` nor a \`load\` thunk, so it has no page to mount`
      );
    }
    if (!Array.isArray(entry.paths) || entry.paths.length === 0) {
      fail(`route "${name}" declares no \`paths\``);
    } else {
      for (const pattern of entry.paths) {
        const problem = patternProblem(pattern);
        if (problem) fail(`route "${name}" pattern ${problem}`);
        if (typeof pattern === 'string') {
          claimants.set(pattern, [...(claimants.get(pattern) ?? []), name]);
        }
      }
    }
  }

  for (const [pattern, names] of claimants) {
    if (names.length > 1) {
      fail(
        `pattern '${pattern}' is claimed by more than one route: ${names.join(', ')} — the last registration wins and the others are unreachable`
      );
    }
  }
  return failures;
}

/**
 * The router turns a pattern straight into a `RegExp`, so an unescaped metachar
 * becomes an operator rather than a literal, and it assigns `queryString` after
 * the `:param` loop, so a param by that name is silently overwritten. Both are
 * cheap to reject here and invisible at runtime.
 *
 * @param {unknown} pattern
 * @returns {string | null} what is wrong with it, or null
 */
function patternProblem(pattern) {
  if (typeof pattern !== 'string') return `${String(pattern)} is not a string`;
  if (!pattern.startsWith('#/')) return `'${pattern}' does not start with '#/'`;
  if (!/^[A-Za-z0-9\-_/:#]+$/.test(pattern)) {
    return `'${pattern}' contains a character that is not a letter, digit, '-', '_', '/', ':' or '#'`;
  }
  const segments = pattern.slice(1).split('/').slice(1);
  if (pattern !== '#/' && segments.some((segment) => segment === '')) {
    return `'${pattern}' has an empty segment`;
  }

  /** @type {Set<string>} */
  const params = new Set();
  for (const [, param] of pattern.matchAll(/:([^/]+)/g)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(param)) {
      return `'${pattern}' declares the parameter ':${param}', which is not a valid name`;
    }
    if (param === 'queryString') {
      return `'${pattern}' declares ':queryString', a name the router reserves for the raw query`;
    }
    if (params.has(param)) {
      return `'${pattern}' declares ':${param}' twice, so one of them is overwritten`;
    }
    params.add(param);
  }
  return null;
}
