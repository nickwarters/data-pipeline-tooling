// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  currentOutcome,
  buildAmendmentFields,
} from '../src/evaluators/amended-outcome.js';
import { makeCaseRow } from './helpers/fixtures.js';

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').AmendedOutcome} AmendedOutcome */

/** @returns {CaseRow} */
function makeCase(overrides = {}) {
  return makeCaseRow({
    id: 'c1',
    caseType: 'example-review',
    title: 'T',
    status: 'Completed',
    assignedReviewer: 'u1',
    responsibleParty: 'u2',
    completedAt: '2026-06-10T00:00:00Z',
    etag: 'e1',
    ...overrides,
  });
}

// --- currentOutcome ---

test('currentOutcome: equals the frozen snapshot when there is no amendment', () => {
  const c = makeCase({ outcomeAtCompletion: 'fail' });
  assert.equal(currentOutcome(c), 'fail');
});

test('currentOutcome: the Amended Outcome takes precedence over the frozen snapshot', () => {
  const c = makeCase({
    outcomeAtCompletion: 'fail',
    amendedOutcome: {
      outcome: 'pass',
      justification: 'Reviewer misread the call',
      amendedBy: 'controls-1',
      amendedAt: '2026-06-12T00:00:00Z',
    },
  });
  assert.equal(currentOutcome(c), 'pass');
});

test('currentOutcome: is undefined before the reportable snapshot exists', () => {
  const c = makeCase({ status: 'In-progress' });
  delete (/** @type {any} */ (c).outcomeAtCompletion);
  assert.equal(currentOutcome(c), undefined);
});

test('currentOutcome: a null amendedOutcome falls through to the snapshot', () => {
  const c = makeCase({ outcomeAtCompletion: 'pass', amendedOutcome: null });
  assert.equal(currentOutcome(c), 'pass');
});

// --- buildAmendmentFields ---

test('buildAmendmentFields: re-stamps the effective columns from the hand-set verdict', () => {
  const c = makeCase({ outcomeAtCompletion: 'fail', hadRemediation: true });
  /** @type {AmendedOutcome} */
  const amendment = {
    outcome: 'pass',
    justification: 'Corrected',
    amendedBy: 'controls-1',
    amendedAt: '2026-06-12T00:00:00Z',
  };

  const fields = buildAmendmentFields(c, amendment);

  assert.deepEqual(fields, {
    amendedOutcome: amendment,
    effectiveOutcome: 'pass',
    effectiveHadRemediation: true,
    outcomeOverridden: true,
  });
});

test('buildAmendmentFields: leaves the frozen snapshot untouched', () => {
  const c = makeCase({ outcomeAtCompletion: 'fail', hadRemediation: false });
  buildAmendmentFields(c, {
    outcome: 'pass',
    justification: 'x',
    amendedBy: 'controls-1',
    amendedAt: '2026-06-12T00:00:00Z',
  });
  assert.equal(c.outcomeAtCompletion, 'fail', 'outcomeAtCompletion is frozen');
});

test('buildAmendmentFields: effectiveHadRemediation defaults to false when hadRemediation is absent', () => {
  const c = makeCase({ outcomeAtCompletion: 'fail' });
  const fields = buildAmendmentFields(c, {
    outcome: 'refer',
    justification: 'x',
    amendedBy: 'controls-1',
    amendedAt: '2026-06-12T00:00:00Z',
  });
  assert.equal(fields.effectiveHadRemediation, false);
});
