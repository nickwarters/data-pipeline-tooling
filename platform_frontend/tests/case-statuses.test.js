// @ts-check

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CASE_STATUS } from '../src/lib/case-statuses.js';

test('CASE_STATUS exposes the exact persisted Case lifecycle status values', () => {
  assert.equal(CASE_STATUS.IN_PROGRESS, 'In-progress');
  assert.equal(CASE_STATUS.ACTIONS_IN_PROGRESS, 'Actions In Progress');
  assert.equal(CASE_STATUS.COMPLETED, 'Completed');
});

test('CASE_STATUS is frozen (values cannot be reassigned)', () => {
  assert.throws(() => {
    // @ts-expect-error - intentionally assigning to a frozen property
    CASE_STATUS.IN_PROGRESS = 'tampered';
  }, /Cannot assign|read.only/i);
  assert.equal(CASE_STATUS.IN_PROGRESS, 'In-progress');
});

test('CASE_STATUS has exactly the three case-lifecycle statuses (no accidental extra keys)', () => {
  assert.deepEqual(Object.keys(CASE_STATUS).sort(), [
    'ACTIONS_IN_PROGRESS',
    'COMPLETED',
    'IN_PROGRESS',
  ]);
});

// --- Contract: no raw case-lifecycle status literals in src/ ---------------
//
// Style of tests/framework-contract.test.js: read the sources and fail on a
// forbidden pattern. Every case-lifecycle status comparison or assignment in
// src/ must go through CASE_STATUS from src/lib/case-statuses.js — a typo in
// a raw literal is a silent logic failure, this test makes it a loud one.
//
// Scope decisions:
// - Only Case row lifecycle status is covered. Remediation-action statuses
//   ('pending'/'complete'/'cancelled'), team-cases filter statuses
//   ('overdue'/'outstanding'/'completed') and SaveQueue's 'conflict' are
//   different domain concepts and stay as-is.
// - Comments may mention the literals (docs quote the lifecycle), so comments
//   are stripped before searching.
// - `case-types/` config modules keep raw literals: they are declarative
//   config data mirroring the persisted values (e.g. example-review.js
//   `allowMessagesWhen: ['Actions In Progress']`), authored by Case Type
//   Owners who should not need framework imports. Hence only `src/` is
//   scanned here; `dev/fixtures/` (mock persisted rows) and test files
//   asserting user-visible output likewise keep literals.

const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url));
const CONSTANTS_MODULE = 'lib/case-statuses.js';

/**
 * @param {string} dir
 * @returns {string[]} absolute paths of every .js file under dir
 */
function jsFilesUnder(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Strip `//` line comments and block comments. Deliberately
 * simple (mirrors the string-search technique of framework-contract.test.js);
 * at worst it hides a literal that shares a line with a `//` in a string,
 * which can only under-report, never false-positive.
 *
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

test('contract: no raw case-lifecycle status literals in src/ outside lib/case-statuses.js', () => {
  const forbidden = /['"`](In-progress|Actions In Progress|Completed)['"`]/;
  /** @type {string[]} */
  const violations = [];
  for (const file of jsFilesUnder(SRC_ROOT)) {
    const rel = relative(SRC_ROOT, file).split('\\').join('/');
    if (rel === CONSTANTS_MODULE) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    const match = code.match(forbidden);
    if (match) violations.push(`src/${rel}: ${match[0]}`);
  }
  assert.deepEqual(
    violations,
    [],
    `Raw case-lifecycle status literal(s) found — import CASE_STATUS from src/lib/case-statuses.js instead:\n${violations.join('\n')}`
  );
});
