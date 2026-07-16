// @ts-check
// Guards the storage/provisioning contract (issue #239, ADR-0007 amend): the
// fixtures must exercise every lifecycle status and the fields stamped at the
// reportable milestone, and a Remediation Action stored in the Answers blob must
// coerce from both the new object shape and a legacy bare string (ADR-0024).
//
// These assertions run against the example-review test fixture, which carries
// the full lifecycle set (including Actions In Progress) and the legacy-shaped
// capture data. example-review was retired from the mock client in issue #383;
// the mock-served complaints fixtures no longer cover Actions In Progress.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exampleReviewCases as cases } from './_example-review-cases.js';
import { coerceRemediationActions } from '../src/evaluators/remediation-actions.js';

test('fixtures exercise all three lifecycle statuses (ADR-0023)', () => {
  const statuses = new Set(cases.map((c) => c.status));
  /** @type {Array<'In-progress' | 'Actions In Progress' | 'Completed'>} */
  const expectedStatuses = ['In-progress', 'Actions In Progress', 'Completed'];
  for (const expected of expectedStatuses) {
    assert.ok(
      statuses.has(expected),
      `expected a fixture Case with status ${expected}`
    );
  }
});

test('the Actions In Progress fixture stamps reportableAt/remediationDueDate but not completedAt', () => {
  const c = cases.find((c) => c.status === 'Actions In Progress');
  assert.ok(c, 'an Actions In Progress fixture exists');
  assert.equal(typeof c.reportableAt, 'string');
  assert.equal(typeof c.remediationDueDate, 'string');
  assert.equal(c.completedAt, null);
  // The Outcome snapshot is frozen at the reportable milestone (ADR-0012/0023).
  assert.equal(typeof c.outcomeAtCompletion, 'string');
  assert.equal(c.outcomeOverridden, false);
});

test('Answers-blob Remediation Actions coerce from the new object shape and a legacy string (ADR-0024)', () => {
  const c = cases.find((c) => c.status === 'Actions In Progress');
  assert.ok(c);
  const raw = c.answers['q-needs']?.capture?.remediationActions;
  assert.ok(
    Array.isArray(raw),
    'the failed Answer carries a sent-actions array'
  );

  const actions = coerceRemediationActions(
    /** @type {Array<string | import('../src/sharepoint-client.js').RemediationAction>} */ (
      raw
    ),
    'remediationActions'
  );
  // Every entry — object or legacy string — normalises to the stateful record.
  for (const a of actions) {
    assert.equal(typeof a.id, 'string');
    assert.notEqual(a.id, '');
    assert.equal(typeof a.text, 'string');
    assert.ok(['pending', 'complete', 'cancelled'].includes(a.status));
  }
  // The legacy bare string became a pending action with a synthesised id.
  assert.ok(actions.some((a) => a.status === 'pending'));
});
