// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amendOutcome,
  openAppealOf,
  raiseAppeal,
  resolveAppeal,
} from '../src/pages/cora-case-review/appeal-actions.js';

/** @type {import('../src/sharepoint-client.js').CaseRow} */
const CASE_ROW = {
  id: 'c1',
  caseType: 'example-review',
  title: 'Case',
  status: 'Completed',
  assignedReviewer: 'reviewer',
  responsibleParty: 'rp',
  answers: {},
  conversation: [],
  notes: '',
  completedAt: '2026-07-01T00:00:00Z',
  outcomeAtCompletion: 'fail',
  hadRemediation: true,
  etag: 'e1',
};

test('raiseAppeal returns a new row and preserves the existing Appeal history', () => {
  const existing = {
    id: 'a0',
    appellant: 'rp',
    at: '2026-06-01T00:00:00Z',
    rationale: 'Earlier',
    state: /** @type {'resolved'} */ ('resolved'),
  };
  const original = { ...CASE_ROW, appeals: [existing] };
  const result = raiseAppeal({
    caseRow: original,
    appellant: 'manager',
    rationale: 'Reconsider',
    citedAnswerKeys: ['q1'],
    id: 'a1',
    at: '2026-07-02T00:00:00Z',
  });

  assert.notEqual(result.caseRow, original);
  assert.deepEqual(original.appeals, [existing]);
  assert.deepEqual(
    result.appeals.map((appeal) => appeal.id),
    ['a0', 'a1']
  );
  assert.deepEqual(result.appeals[1].citedAnswerKeys, ['q1']);
});

test('raiseAppeal omits citations when none are selected on a Case without history', () => {
  const result = raiseAppeal({
    caseRow: CASE_ROW,
    appellant: 'manager',
    rationale: 'Reconsider',
    citedAnswerKeys: [],
    id: 'a1',
    at: '2026-07-02T00:00:00Z',
  });

  assert.equal(result.appeals.length, 1);
  assert.equal(result.appeals[0].citedAnswerKeys, undefined);
});

test('resolveAppeal returns one transactional field set when Controls agrees', () => {
  const original = {
    ...CASE_ROW,
    appeals: [
      {
        id: 'a1',
        appellant: 'manager',
        at: '2026-07-02T00:00:00Z',
        rationale: 'Reconsider',
        state: /** @type {'raised'} */ ('raised'),
      },
    ],
  };
  const result = resolveAppeal({
    caseRow: original,
    appealId: 'a1',
    verdict: 'agreed',
    rationale: 'Agreed',
    resolver: 'controls',
    at: '2026-07-03T00:00:00Z',
    outcome: 'pass',
    justification: 'Corrected',
  });

  assert.equal(result.transactional, true);
  assert.equal(original.appeals[0].state, 'raised');
  assert.equal(result.fields.appeals[0].state, 'resolved');
  assert.equal(result.fields.amendedOutcome?.fromAppealId, 'a1');
  assert.equal(result.fields.effectiveOutcome, 'pass');
  assert.equal(result.fields.outcomeOverridden, true);
});

test('resolveAppeal rejection updates only Appeal history without mutating the source row', () => {
  const original = {
    ...CASE_ROW,
    appeals: [
      {
        id: 'a1',
        appellant: 'manager',
        at: '2026-07-02T00:00:00Z',
        rationale: 'Reconsider',
        state: /** @type {'raised'} */ ('raised'),
      },
    ],
  };
  const result = resolveAppeal({
    caseRow: original,
    appealId: 'a1',
    verdict: 'rejected',
    rationale: 'Original result stands',
    resolver: 'controls',
    at: '2026-07-03T00:00:00Z',
  });

  assert.equal(result.transactional, false);
  assert.equal(original.appeals[0].state, 'raised');
  assert.equal(result.fields.appeals[0].resolution?.verdict, 'rejected');
  assert.deepEqual(Object.keys(result.fields), ['appeals']);
});

test('resolveAppeal defensively normalises absent agreement details', () => {
  const result = resolveAppeal({
    caseRow: { ...CASE_ROW, appeals: [] },
    appealId: 'missing',
    verdict: 'agreed',
    rationale: 'Agreed',
    resolver: 'controls',
    at: '2026-07-03T00:00:00Z',
  });

  assert.equal(result.fields.amendedOutcome?.outcome, '');
  assert.equal(result.fields.amendedOutcome?.justification, '');
});

test('amendOutcome returns immutable fields without changing the frozen snapshot', () => {
  const result = amendOutcome({
    caseRow: CASE_ROW,
    outcome: 'pass',
    justification: 'Corrected',
    amendedBy: 'controls',
    amendedAt: '2026-07-03T00:00:00Z',
  });

  assert.notEqual(result.caseRow, CASE_ROW);
  assert.equal(CASE_ROW.amendedOutcome, undefined);
  assert.equal(result.caseRow.outcomeAtCompletion, 'fail');
  assert.equal(result.fields.amendedOutcome?.outcome, 'pass');
  assert.equal(result.fields.effectiveHadRemediation, true);
});

// `openAppealOf` is the single definition of "the Appeal that is still open".
// It previously existed as three copies: one exported `openAppealFrom`
// per Appeal view, and an inlined `find` in the in-memory flow runner.
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
});
