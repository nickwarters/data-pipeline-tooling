// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openAppealOf } from '../src/evaluators/appeal-state.js';
import { makeCaseRow } from './helpers/fixtures.js';

const CASE_ROW = makeCaseRow({
  id: 'c1',
  caseType: 'example-review',
  title: 'Case',
  status: 'Completed',
  assignedReviewer: 'reviewer',
  responsibleParty: 'rp',
  completedAt: '2026-07-01T00:00:00Z',
  outcomeAtCompletion: 'fail',
});

// `openAppealOf` is the single definition of "the Appeal that is still open".
// It previously existed as three copies: one per Appeal view, one on the
// Controls worklist, and a private predicate inside Section access.
test('openAppealOf finds the one Appeal that is not resolved', () => {
  const resolved = {
    id: 'a0',
    appellant: 'rp',
    rationale: 'First',
    citedAnswerKeys: [],
    at: '2026-07-01T00:00:00Z',
    state: /** @type {const} */ ('resolved'),
  };
  const open = /** @type {const} */ ({
    ...resolved,
    id: 'a1',
    rationale: 'Second',
    state: 'raised',
  });

  assert.equal(
    openAppealOf({ ...CASE_ROW, appeals: [resolved, open] })?.id,
    'a1'
  );
});

test('openAppealOf returns null when every Appeal is resolved, or there are none', () => {
  const resolved = {
    id: 'a0',
    appellant: 'rp',
    rationale: 'First',
    citedAnswerKeys: [],
    at: '2026-07-01T00:00:00Z',
    state: /** @type {const} */ ('resolved'),
  };

  assert.equal(openAppealOf({ ...CASE_ROW, appeals: [resolved] }), null);
  assert.equal(openAppealOf({ ...CASE_ROW, appeals: [] }), null);
  assert.equal(openAppealOf(CASE_ROW), null);
  assert.equal(openAppealOf(null), null);
  assert.equal(openAppealOf(undefined), null);
});

// The write seam asks the question of a PATCH payload's `appeals` list, which
// is not a whole Case Row — so the predicate must accept one.
test('openAppealOf reads an appeals list that is not carried on a Case Row', () => {
  const open = /** @type {const} */ ({
    id: 'a1',
    appellant: 'rp',
    rationale: 'Only',
    at: '2026-07-02T00:00:00Z',
    state: 'raised',
  });
  assert.equal(openAppealOf({ appeals: [open] })?.id, 'a1');
});
