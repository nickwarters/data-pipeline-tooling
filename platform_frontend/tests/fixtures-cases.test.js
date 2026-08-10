// @ts-check
// Guards the storage/provisioning contract: the
// fixtures must exercise every lifecycle status and the fields stamped at the
// reportable milestone, and a Remediation Action stored in the Answers blob must
// coerce from both the new object shape and a legacy bare string.
//
// These assertions run against the example-review test fixture, which carries
// the full lifecycle set (including Actions In Progress) and the legacy-shaped
// capture data. example-review was retired from the mock client, so the
// mock-served complaints fixtures are guarded separately below, including the
// demoable "remediation sent to the adviser" Case.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exampleReviewCases as cases } from './_example-review-cases.js';
import { cases as mockCases } from '../dev/fixtures/cases.js';
import { personas } from '../dev/fixtures/personas.js';
import { isRemediationResolved } from '../src/evaluators/remediation-status.js';
import { openAppealFields } from '../src/services/action-centre-flags.js';
import { CASE_STATUS } from '../src/lib/case-statuses.js';
import { outstandingRemediation } from '../src/pages/responsible-party/view.js';

test('the example-review fixtures exercise the three statuses a review passes through', () => {
  // Scoped to the reviewing path on purpose: these fixtures drive the
  // example-review walkthrough from opening a Case to completing it. The
  // terminal Void status is demonstrated by the mock-client fixtures instead,
  // which is where the manager report reads its rows from.
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
  // The Outcome snapshot is frozen at the reportable milestone.
  assert.equal(typeof c.outcomeAtCompletion, 'string');
  assert.equal(c.outcomeOverridden, false);
});

// --- mock-served complaints fixtures -------------------------
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

test('a mock complaints Case has remediation sent and still in progress', () => {
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
  // the Responsible Party's outstanding count.
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

test('the sent-to-adviser Case is addressed to a Responsible Party persona', () => {
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

test('the sent-to-adviser Case names a Responsible Party Manager persona', () => {
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

test('a mock complaints Case is unallocated, so the allocation flow has a candidate', () => {
  // "Take a Case" reads the unallocated pool: with every fixture Case already
  // assigned, the allocation panel demos as permanently empty.
  const row = mockCases.find(
    (c) =>
      c.caseType === 'complaints' &&
      c.assignedReviewer === '' &&
      c.status === 'In-progress' &&
      Object.keys(c.answers).length === 0
  );
  assert.ok(row, 'an unallocated, unanswered In-progress Complaints Case');
});

test('the sent-to-adviser Case names a Reviewer Manager persona', () => {
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

test('every assigned mock Case carries the moment it was assigned', () => {
  // The Assigned column reads this, not the creation date, so a fixture that
  // omits it demos as an empty column rather than as a wrong one.
  for (const row of mockCases) {
    if (row.assignedReviewer) {
      assert.equal(
        typeof row.assignedAt,
        'string',
        `${row.id} names a Reviewer but no assignment time`
      );
    } else {
      assert.equal(
        row.assignedAt,
        null,
        `${row.id} has nobody assigned, so it can carry no assignment time`
      );
    }
  }
});

// A seeded flag has to be a state the product could have reached: the demo set
// is the first thing anyone sees, and an open Appeal with no Appeal — or an
// awaiting clock reading an instant no writer could have stamped — demos a
// state no transition can produce. Two writers set the awaiting pair, so its
// clock is either the last Conversation message's own timestamp or the instant
// the hand-off was stamped. `reviewRequired` is exempt while nothing writes it.
test('every mock fixture row carries flags a transition could have written', () => {
  for (const row of mockCases) {
    const where = `fixture ${row.id}`;
    if (row.appeals !== undefined) {
      assert.deepEqual(
        {
          hasOpenAppeal: Boolean(row.hasOpenAppeal),
          appealRaisedAt: row.appealRaisedAt ?? null,
        },
        openAppealFields(row.appeals),
        `${where}: the open-Appeal pair does not match its Appeals`
      );
    } else {
      assert.ok(
        !row.hasOpenAppeal,
        `${where}: open Appeal flag with no Appeal`
      );
    }

    const lastMessage = row.conversation.at(-1);
    if (row.awaitingResponsibleParty) {
      const sentClock =
        row.status === CASE_STATUS.ACTIONS_IN_PROGRESS
          ? row.reportableAt
          : null;
      assert.ok(
        row.awaitingSince &&
          (row.awaitingSince === lastMessage?.timestamp ||
            row.awaitingSince === sentClock),
        `${where}: awaitingSince is neither the last message's own timestamp nor the Send Actions instant`
      );
    } else {
      assert.ok(
        !row.awaitingSince,
        `${where}: an awaiting clock with the flag off`
      );
    }
  }
});
