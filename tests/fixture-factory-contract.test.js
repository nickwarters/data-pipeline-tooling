// @ts-check

/**
 * Hand-built Case rows and capabilities objects are what the shared factories
 * in `helpers/fixtures.js` exist to replace, so a new one must not creep back
 * in: a file that names every key of a shape is building the whole shape by
 * hand. The chrome slice has no rule of its own — it is two generic keys
 * (`currentUser`, `permissions`) that match far too much to police — so the
 * capability rule stands in for it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeCaseRow, makePermissions } from './helpers/fixtures.js';

const TESTS_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)));
const THIS_FILE = basename(fileURLToPath(import.meta.url));

/**
 * Written out rather than derived from `Object.keys(makeCaseRow())`: deriving
 * them would mean a future optional default silently widened the set and the
 * rule stopped matching the literals it exists to catch.
 */
const REQUIRED_CASE_ROW_KEYS = [
  'id',
  'caseType',
  'title',
  'status',
  'assignedReviewer',
  'responsibleParty',
  'answers',
  'conversation',
  'notes',
  'completedAt',
  'etag',
];

const CAPABILITY_KEYS = [
  'isReviewer',
  'listAccessCaseTypes',
  'isAdviser',
  'ownedCaseTypes',
  'ownedJourneyCaseTypes',
  'isControls',
  'isReviewerManager',
  'isResponsiblePartyManager',
  'isMaintainer',
  'canSearchCases',
  'isVisitor',
];

const EXEMPT = [
  // The factories themselves: the literal here IS the shape.
  'helpers/fixtures.js',
  // A frozen sample of real rows the example-review suites read as data.
  '_example-review-cases.js',
  // Parity and mock-client suites assert the client's storage and filtering
  // over whole rows, so the row shape is the thing under test.
  'list-cases-filter-parity.test.js',
  'mock-sharepoint-client-abort.test.js',
  'mock-sharepoint-client-filters.test.js',
  'mock-sharepoint-client-storage.test.js',
  // The client contract suite pins the wire shape a row is serialised from.
  'sharepoint-client-contract.test.js',
];

function javascriptTests() {
  /** @param {string} directory @returns {{ name: string, source: string }[]} */
  const collect = (directory) =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return collect(path);
      if (!entry.name.endsWith('.js') || entry.name === THIS_FILE) return [];
      const name = path.slice(TESTS_DIR.length + 1);
      if (EXEMPT.includes(name)) return [];
      return [{ name, source: readFileSync(path, 'utf8') }];
    });

  return collect(TESTS_DIR);
}

/**
 * How close together every key has to appear to count as one object. A
 * hand-built row spans a few hundred characters; a long suite mentions all the
 * same names eventually, spread over thousands of lines and a dozen unrelated
 * partial objects, which is not the same thing.
 */
const ONE_OBJECT = 600;

/**
 * Where a key is named. Both `key:` and the shorthand `key,` / `key}` count —
 * several suites build these objects from variables of the same name.
 *
 * @param {string} source @param {string} key
 */
const positionsOf = (source, key) =>
  [...source.matchAll(new RegExp(`(^|[\\s,{(])${key}\\s*[:,}]`, 'g'))].map(
    (match) => match.index
  );

/**
 * True when every key is named within one object's distance of the same
 * mention of the first key. Anchoring on the first key costs nothing: `id` and
 * `isReviewer` are in every hand-built copy of these shapes.
 *
 * The rule cannot tell a literal from an override bag, so a legitimate
 * `makeCaseRow()` call that happens to name every field will trip it — say
 * less in the override and it passes.
 *
 * @param {string} source @param {string[]} keys
 */
function buildsWholeShape(source, keys) {
  const found = keys.map((key) => positionsOf(source, key));
  return found[0].some((anchor) =>
    found.every((positions) =>
      positions.some((at) => Math.abs(at - anchor) <= ONE_OBJECT)
    )
  );
}

test('the factories still cover the shapes this rule polices', () => {
  const caseRowKeys = Object.keys(makeCaseRow());
  const missing = REQUIRED_CASE_ROW_KEYS.filter(
    (key) => !caseRowKeys.includes(key)
  );

  assert.deepEqual(
    missing,
    [],
    'makeCaseRow must default every required Case row field'
  );
  assert.deepEqual(
    Object.keys(makePermissions()).sort(),
    [...CAPABILITY_KEYS].sort(),
    'makePermissions and this rule must name the same capabilities'
  );
});

test('tests do not hand-build a whole Case row', () => {
  const offenders = javascriptTests()
    .filter(({ source }) => buildsWholeShape(source, REQUIRED_CASE_ROW_KEYS))
    .map(({ name }) => name);

  assert.deepEqual(
    offenders,
    [],
    'build Case rows with makeCaseRow() from helpers/fixtures.js and override only what the test asserts on'
  );
});

test('tests do not hand-build a whole capabilities object', () => {
  const offenders = javascriptTests()
    .filter(({ source }) => buildsWholeShape(source, CAPABILITY_KEYS))
    .map(({ name }) => name);

  assert.deepEqual(
    offenders,
    [],
    'build capabilities with makePermissions() from helpers/fixtures.js and override only the capabilities the test needs'
  );
});
