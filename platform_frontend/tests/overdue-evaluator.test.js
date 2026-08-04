// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOverdue,
  isRemediationOverdue,
} from '../src/evaluators/overdue-evaluator.js';
import { makeCaseRow } from './helpers/fixtures.js';

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

const PAST = new Date('2020-01-01T00:00:00Z');
const FUTURE = new Date('2099-01-01T00:00:00Z');
const NOW = new Date('2026-05-17T12:00:00Z');

// No date fields at all: every case below opts into exactly the one date the
// assertion is about, so an absent dueDate stays genuinely absent.
/** @returns {CaseRow} */
function baseCase() {
  return makeCaseRow({
    id: 'c1',
    caseType: 'example-review',
    title: 'Test',
    assignedReviewer: '',
    responsibleParty: '',
  });
}

// --- tracer bullet ---

test('isOverdue: past dueDate and In-progress → true', () => {
  const c = { ...baseCase(), dueDate: PAST.toISOString() };
  assert.strictEqual(isOverdue(c, NOW), true);
});

// --- null / missing dueDate ---

test('isOverdue: null dueDate → false', () => {
  const c = { ...baseCase(), dueDate: null };
  assert.strictEqual(isOverdue(c, NOW), false);
});

test('isOverdue: missing dueDate → false', () => {
  const c = baseCase(); // no dueDate property
  assert.strictEqual(isOverdue(c, NOW), false);
});

// --- future dueDate ---

test('isOverdue: future dueDate → false', () => {
  const c = { ...baseCase(), dueDate: FUTURE.toISOString() };
  assert.strictEqual(isOverdue(c, NOW), false);
});

// --- completed cases never overdue ---

test('isOverdue: Completed case with past dueDate → false', () => {
  const c = {
    ...baseCase(),
    status: /** @type {'Completed'} */ ('Completed'),
    dueDate: PAST.toISOString(),
  };
  assert.strictEqual(isOverdue(c, NOW), false);
});

// Once actions have been sent the review itself is finished, so the review due
// date stops meaning anything: the remediation deadline is the clock that
// governs this phase, and it is a different date on the same Case.
test('isOverdue: Actions In Progress case with past dueDate → false', () => {
  const c = {
    ...baseCase(),
    status: /** @type {'Actions In Progress'} */ ('Actions In Progress'),
    dueDate: PAST.toISOString(),
  };
  assert.strictEqual(isOverdue(c, NOW), false);
});

// --- boundary ---

test('isOverdue: dueDate exactly at now → false (not strictly past)', () => {
  const c = { ...baseCase(), dueDate: NOW.toISOString() };
  assert.strictEqual(isOverdue(c, NOW), false);
});

// --- the remediation clock ---

test('isRemediationOverdue: Actions In Progress past the deadline → true', () => {
  const c = {
    ...baseCase(),
    status: /** @type {'Actions In Progress'} */ ('Actions In Progress'),
  };
  assert.strictEqual(isRemediationOverdue(c, PAST.toISOString(), NOW), true);
});

test('isRemediationOverdue: Completed case past the deadline → false', () => {
  const c = {
    ...baseCase(),
    status: /** @type {'Completed'} */ ('Completed'),
  };
  assert.strictEqual(isRemediationOverdue(c, PAST.toISOString(), NOW), false);
});

test('isRemediationOverdue: null deadline → false', () => {
  assert.strictEqual(isRemediationOverdue(baseCase(), null, NOW), false);
});

test('isRemediationOverdue: absent deadline → false', () => {
  assert.strictEqual(isRemediationOverdue(baseCase(), undefined, NOW), false);
});

test('isRemediationOverdue: future deadline → false', () => {
  assert.strictEqual(
    isRemediationOverdue(baseCase(), FUTURE.toISOString(), NOW),
    false
  );
});

test('isRemediationOverdue: defaults now to the current time without throwing', () => {
  assert.strictEqual(
    typeof isRemediationOverdue(baseCase(), PAST.toISOString()),
    'boolean'
  );
});
