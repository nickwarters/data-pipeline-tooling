// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCase,
  makeConfig,
  makeCaseWithRemediation,
  openAppeal,
  assertGrid,
  SECTIONS,
} from './helpers/section-access.js';

// Capability: the complete role-by-section access matrix.

// --- The Section set ---

test('SECTIONS is the amended ten-Section set (appeal split into request/review + amendOutcome)', () => {
  assert.deepEqual(
    [...SECTIONS],
    [
      'details',
      'questions',
      'issues',
      'summary',
      'remediation',
      'notes',
      'conversation',
      'appealRequest',
      'appealReview',
      'amendOutcome',
    ]
  );
  // The pre-amend keys are gone.
  const asStrings = /** @type {string[]} */ (SECTIONS);
  assert.ok(!asStrings.includes('appeal'));
  assert.ok(!asStrings.includes('outcome'));
});

test('matrix — In-progress Case (no actions, default appeal config → responsiblePartyManager raiser)', () => {
  const cfg = makeConfig();
  const c = makeCase({ status: 'In-progress' });
  assertGrid(
    {
      details: {
        assignedReviewer: 'read-only',
        otherReviewer: 'read-only',
        responsibleParty: 'hidden',
        responsiblePartyManager: 'hidden',
        caseTypeOwner: 'read-only',
        journeyOwner: 'read-only',
        controls: 'read-only',
        none: 'hidden',
      },
      questions: {
        assignedReviewer: 'edit',
        otherReviewer: 'read-only',
        responsibleParty: 'hidden',
        responsiblePartyManager: 'hidden',
        caseTypeOwner: 'read-only',
        journeyOwner: 'read-only',
        controls: 'read-only',
        none: 'hidden',
      },
      issues: {
        assignedReviewer: 'edit',
        otherReviewer: 'read-only',
        responsibleParty: 'hidden',
        responsiblePartyManager: 'hidden',
        caseTypeOwner: 'read-only',
        journeyOwner: 'read-only',
        controls: 'read-only',
        none: 'hidden',
      },
      summary: {
        assignedReviewer: 'read-only',
        otherReviewer: 'read-only',
        responsibleParty: 'hidden',
        responsiblePartyManager: 'hidden',
        caseTypeOwner: 'read-only',
        journeyOwner: 'read-only',
        controls: 'read-only',
        none: 'hidden',
      },
      remediation: {
        assignedReviewer: 'hidden',
        otherReviewer: 'hidden',
        responsibleParty: 'hidden',
        responsiblePartyManager: 'hidden',
        caseTypeOwner: 'hidden',
        journeyOwner: 'hidden',
        controls: 'hidden',
        none: 'hidden',
      },
      notes: {
        assignedReviewer: 'edit',
        otherReviewer: 'read-only',
        responsibleParty: 'hidden',
        responsiblePartyManager: 'hidden',
        caseTypeOwner: 'read-only',
        journeyOwner: 'hidden',
        controls: 'hidden',
        none: 'hidden',
      },
      conversation: {
        assignedReviewer: 'edit',
        otherReviewer: 'read-only',
        responsibleParty: 'edit',
        responsiblePartyManager: 'edit',
        caseTypeOwner: 'read-only',
        journeyOwner: 'read-only',
        controls: 'read-only',
        none: 'hidden',
      },
      appealRequest: {
        assignedReviewer: 'read-only',
        otherReviewer: 'hidden',
        responsibleParty: 'hidden',
        responsiblePartyManager: 'hidden',
        caseTypeOwner: 'read-only',
        journeyOwner: 'read-only',
        controls: 'read-only',
        none: 'hidden',
      },
      appealReview: {
        assignedReviewer: 'read-only',
        otherReviewer: 'hidden',
        responsibleParty: 'hidden',
        responsiblePartyManager: 'read-only',
        caseTypeOwner: 'read-only',
        journeyOwner: 'read-only',
        controls: 'read-only',
        none: 'hidden',
      },
      amendOutcome: {
        assignedReviewer: 'hidden',
        otherReviewer: 'hidden',
        responsibleParty: 'hidden',
        responsiblePartyManager: 'hidden',
        caseTypeOwner: 'hidden',
        journeyOwner: 'hidden',
        controls: 'hidden',
        none: 'hidden',
      },
    },
    c,
    cfg
  );
});

test('matrix — Actions In Progress Case with sent actions (reportable freeze)', () => {
  const cfg = makeConfig();
  const c = makeCaseWithRemediation({ status: 'Actions In Progress' });
  assertGrid(
    {
      // Reviewer-edit Sections have frozen to read-only at the reportable milestone.
      questions: {
        assignedReviewer: 'read-only',
        caseTypeOwner: 'read-only',
        journeyOwner: 'read-only',
        controls: 'read-only',
      },
      issues: {
        assignedReviewer: 'read-only',
        controls: 'read-only',
      },
      // The Adviser can now see the Summary (reportable); their Manager cannot yet
      // (Completed-gated).
      summary: {
        responsibleParty: 'read-only',
        responsiblePartyManager: 'hidden',
      },
      // Remediation tracking is now visible: the Assigned Reviewer resolves it,
      // everyone else — including the Responsible Party side, who get the
      // Conversation call-to-action instead of the fields — observes.
      remediation: {
        assignedReviewer: 'edit',
        otherReviewer: 'read-only',
        reviewerManager: 'read-only',
        responsibleParty: 'read-only',
        responsiblePartyManager: 'read-only',
        caseTypeOwner: 'read-only',
        journeyOwner: 'read-only',
        controls: 'read-only',
        none: 'hidden',
      },
      // Notes stay editable for the reviewer until the Case is Completed.
      notes: {
        assignedReviewer: 'edit',
      },
      // Appeal Sections remain Completed-only; Amend Outcome opens to Controls
      // at the reportable milestone, once the Outcome snapshot exists.
      appealRequest: {
        responsiblePartyManager: 'hidden',
        journeyOwner: 'read-only',
      },
      appealReview: { controls: 'read-only' },
      amendOutcome: {
        assignedReviewer: 'hidden',
        otherReviewer: 'hidden',
        reviewerManager: 'hidden',
        responsibleParty: 'hidden',
        responsiblePartyManager: 'hidden',
        caseTypeOwner: 'hidden',
        journeyOwner: 'hidden',
        controls: 'edit',
        none: 'hidden',
      },
    },
    c,
    cfg
  );
});

test('matrix — Completed Case, journeyOwner raiser, no open Appeal', () => {
  const cfg = makeConfig({
    appeal: { raisedBy: 'journeyOwner', resolvedBy: 'controls' },
  });
  const c = makeCase({ status: 'Completed' });
  assertGrid(
    {
      // Notes freeze to read-only at Completed.
      notes: {
        assignedReviewer: 'read-only',
        otherReviewer: 'read-only',
        caseTypeOwner: 'read-only',
        journeyOwner: 'hidden',
        controls: 'hidden',
      },
      // Both the Adviser and their Manager can now read the Summary.
      summary: {
        responsibleParty: 'read-only',
        responsiblePartyManager: 'read-only',
      },
      // The Journey Owner is the configured raiser → edit on Appeal Request.
      appealRequest: {
        assignedReviewer: 'read-only',
        otherReviewer: 'hidden',
        responsibleParty: 'hidden',
        responsiblePartyManager: 'hidden',
        caseTypeOwner: 'read-only',
        journeyOwner: 'edit',
        controls: 'read-only',
        none: 'hidden',
      },
      // No open Appeal → Controls observes Appeal Review read-only.
      appealReview: {
        controls: 'read-only',
      },
      // Amend Outcome is Controls-only: edit on a Completed Case, hidden for
      // every other role (observers read the Current Outcome in the Summary,
      // not this tab).
      amendOutcome: {
        assignedReviewer: 'hidden',
        otherReviewer: 'hidden',
        responsibleParty: 'hidden',
        responsiblePartyManager: 'hidden',
        caseTypeOwner: 'hidden',
        journeyOwner: 'hidden',
        controls: 'edit',
        none: 'hidden',
      },
    },
    c,
    cfg
  );
});

test('matrix — Completed Case, responsiblePartyManager raiser, open Appeal', () => {
  const cfg = makeConfig({
    appeal: { raisedBy: 'responsiblePartyManager', resolvedBy: 'controls' },
  });
  const c = makeCase({ status: 'Completed', appeals: [openAppeal()] });
  assertGrid(
    {
      // The RP Manager is the configured raiser → edit on Appeal Request; a
      // non-raiser Journey Owner observes read-only.
      appealRequest: {
        responsiblePartyManager: 'edit',
        journeyOwner: 'read-only',
      },
      // Open Appeal + Completed → Controls resolves (edit).
      appealReview: {
        assignedReviewer: 'read-only',
        otherReviewer: 'hidden',
        responsibleParty: 'hidden',
        responsiblePartyManager: 'read-only',
        caseTypeOwner: 'read-only',
        journeyOwner: 'read-only',
        controls: 'edit',
        none: 'hidden',
      },
    },
    c,
    cfg
  );
});
