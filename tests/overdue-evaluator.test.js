// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOverdue } from '../src/evaluators/overdue-evaluator.js';

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */

const PAST = new Date('2020-01-01T00:00:00Z');
const FUTURE = new Date('2099-01-01T00:00:00Z');
const NOW = new Date('2026-05-17T12:00:00Z');

/** @returns {CaseRow} */
function baseCase() {
  return {
    id: 'c1',
    caseType: 'hello-review',
    title: 'Test',
    status: 'In-progress',
    assignedReviewer: '',
    responsibleParty: '',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'etag-1',
  };
}

/** @returns {CaseTypeConfig} */
function baseConfig() {
  return {
    slaHours: 48,
    questions: [],
    computeOutcome: () => ({ verdict: 'pass' }),
  };
}

// --- tracer bullet ---

test('isOverdue: past dueDate and In-progress → true', () => {
  const c = { ...baseCase(), dueDate: PAST.toISOString() };
  assert.strictEqual(isOverdue(c, baseConfig(), NOW), true);
});

// --- null / missing dueDate ---

test('isOverdue: null dueDate → false', () => {
  const c = { ...baseCase(), dueDate: null };
  assert.strictEqual(isOverdue(c, baseConfig(), NOW), false);
});

test('isOverdue: missing dueDate → false', () => {
  const c = baseCase(); // no dueDate property
  assert.strictEqual(isOverdue(c, baseConfig(), NOW), false);
});

// --- future dueDate ---

test('isOverdue: future dueDate → false', () => {
  const c = { ...baseCase(), dueDate: FUTURE.toISOString() };
  assert.strictEqual(isOverdue(c, baseConfig(), NOW), false);
});

// --- completed cases never overdue ---

test('isOverdue: Completed case with past dueDate → false', () => {
  const c = {
    ...baseCase(),
    status: /** @type {'Completed'} */ ('Completed'),
    dueDate: PAST.toISOString(),
  };
  assert.strictEqual(isOverdue(c, baseConfig(), NOW), false);
});

// --- boundary ---

test('isOverdue: dueDate exactly at now → false (not strictly past)', () => {
  const c = { ...baseCase(), dueDate: NOW.toISOString() };
  assert.strictEqual(isOverdue(c, baseConfig(), NOW), false);
});
