// @ts-check
// Guards the storage/provisioning contract (issue #239, ADR-0007 amend): the
// fixtures must exercise every lifecycle status and the fields stamped at the
// reportable milestone, and a Remediation Action stored in the Answers blob must
// coerce from both the new object shape and a legacy bare string (ADR-0024).
//
// These assertions run against the example-review test fixture, which carries
// the full lifecycle set (including Actions In Progress) and the legacy-shaped
// capture data. example-review was retired from the mock client in issue #383,
// so the mock-served complaints fixtures are guarded separately below: issue
// #495 adds the demoable "remediation sent to the adviser" Case.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exampleReviewCases as cases } from './_example-review-cases.js';
import { cases as mockCases } from '../dev/fixtures/cases.js';
import { personas } from '../dev/fixtures/personas.js';
import { isRemediationResolved } from '../src/evaluators/remediation-status.js';
import { outstandingRemediation } from '../src/pages/responsible-party/view.js';

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

// --- mock-served complaints fixtures (issue #495) -------------------------
// The ?mock=1 demo set must carry a Case whose Remediation Actions have been
// sent to the adviser and are still outstanding, so the handoff is demoable
// from both sides (?asUser=reviewer and ?asUser=responsible-party).

/** @returns {import('../src/sharepoint-client.js').CaseRow} */
function sentToAdviserCase() {
  const row = mockCases.find(
    (c) =>
      c.caseType === 'complaints' &&
      c.status === 'Actions In Progress' &&
      Object.values(c.answers).some(
        (answer) => (answer.remediationActions?.length ?? 0) > 0
      )
  );
  assert.ok(
    row,
    'a mock complaints Case has Remediation Actions sent and in progress'
  );
  return row;
}

test('a mock complaints Case has remediation sent and still in progress (#495)', () => {
  const row = sentToAdviserCase();
  // Stamped by CaseMachine.transitionToActionsInProgress at Send Actions: the
  // reportable milestone freezes the Outcome but does not close the Case.
  assert.equal(typeof row.reportableAt, 'string');
  assert.equal(typeof row.remediationDueDate, 'string');
  assert.equal(row.completedAt, null);
  assert.equal(typeof row.outcomeAtCompletion, 'string');
  assert.equal(row.hadRemediation, true);
  assert.equal(row.effectiveHadRemediation, true);
  assert.equal(row.effectiveOutcome, row.outcomeAtCompletion);
  assert.equal(row.outcomeOverridden, false);

  // Still outstanding: at least one Question's remediation is unresolved, and
  // at least one other is resolved — so the demo Case exercises both halves of
  // the Responsible Party's outstanding count (#497).
  assert.ok(
    outstandingRemediation(row).length > 0,
    'at least one sent remediation is still outstanding'
  );
  assert.ok(
    Object.values(row.answers).some((answer) =>
      isRemediationResolved(answer.remediationStatus)
    ),
    'at least one sent remediation has been resolved'
  );
});

test('the sent-to-adviser Case is addressed to a Responsible Party persona (#495)', () => {
  const row = sentToAdviserCase();
  const personaIds = new Set(Object.values(personas).map((p) => p.userId));
  assert.ok(
    row.responsibleParty && personaIds.has(row.responsibleParty),
    'the Responsible Party is a switchable ?asUser= persona'
  );
  // The adviser's unread-messages panel needs a message they did not write.
  assert.ok(
    row.conversation.some((message) => message.author !== row.responsibleParty),
    'the Conversation carries a message from someone other than the adviser'
  );
});

test('the sent-to-adviser Case names a Responsible Party Manager persona (#499)', () => {
  // Both Remediation audiences must be switchable in mock mode. The Manager's
  // role is resolved from the Case row field, not group membership, so the
  // fixture has to name them for the responsible-party rendering — and the
  // Conversation it points at — to be demoable.
  const row = sentToAdviserCase();
  const personaIds = new Set(Object.values(personas).map((p) => p.userId));
  assert.ok(
    row.responsiblePartyManager && personaIds.has(row.responsiblePartyManager),
    'the Responsible Party Manager is a switchable ?asUser= persona'
  );
  assert.notEqual(row.responsiblePartyManager, row.responsibleParty);
});

test('the sent-to-adviser Case names a Reviewer Manager persona (#499)', () => {
  // The reviewer-side Remediation rendering is held by the Assigned Reviewer's
  // manager too, and that role is now resolved from the `assignedReviewerManager`
  // row field rather than group membership — so the fixture has to name them for
  // the read-only reviewer rendering to be demoable.
  const row = sentToAdviserCase();
  const personaIds = new Set(Object.values(personas).map((p) => p.userId));
  assert.ok(
    row.assignedReviewerManager && personaIds.has(row.assignedReviewerManager),
    'the Reviewer Manager is a switchable ?asUser= persona'
  );
  assert.notEqual(row.assignedReviewerManager, row.assignedReviewer);
});
