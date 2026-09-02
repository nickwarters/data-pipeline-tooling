// @ts-check
import { test } from 'node:test';
import {
  makeCase,
  makeConfig,
  makeCaseWithRemediation,
  openAppeal,
  assertGrid,
  assertMatrixGrid,
} from './helpers/section-access.js';

// Capability: the complete role-by-section access matrix.

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
      // Appeal Request belongs to the configured raiser and nobody else; on a
      // Case that is not Completed even they cannot see it.
      appealRequest: {
        assignedReviewer: 'hidden',
        otherReviewer: 'hidden',
        responsibleParty: 'hidden',
        responsiblePartyManager: 'hidden',
        caseTypeOwner: 'hidden',
        journeyOwner: 'hidden',
        controls: 'hidden',
        none: 'hidden',
      },
      // Nobody sees Appeal Review until an Appeal exists, and Controls is the
      // only role that ever does.
      appealReview: {
        assignedReviewer: 'hidden',
        otherReviewer: 'hidden',
        responsibleParty: 'hidden',
        responsiblePartyManager: 'hidden',
        caseTypeOwner: 'hidden',
        journeyOwner: 'hidden',
        controls: 'hidden',
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
      // Appeal Sections remain Completed-only, and Appeal Review stays hidden
      // while this Case carries no Appeal; Amend Outcome opens to Controls
      // at the reportable milestone, once the Outcome snapshot exists.
      appealRequest: {
        responsiblePartyManager: 'hidden',
        journeyOwner: 'hidden',
      },
      appealReview: { controls: 'hidden' },
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

test('matrix — Completed Case, journeyOwner raiser, no Appeal raised', () => {
  const cfg = makeConfig({
    appeal: { raisedBy: 'journeyOwner' },
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

  // The Appeal rows are asserted at the matrix, not through `evaluateAccess`:
  // appeals are switched off in this build, so `evaluateAccess` answers `hidden`
  // for both Sections whatever the row says. This is the policy they resume
  // under.
  assertMatrixGrid(
    {
      // The Journey Owner is the configured raiser → edit on Appeal Request.
      appealRequest: {
        assignedReviewer: 'hidden',
        otherReviewer: 'hidden',
        responsibleParty: 'hidden',
        responsiblePartyManager: 'hidden',
        caseTypeOwner: 'hidden',
        journeyOwner: 'edit',
        controls: 'hidden',
        none: 'hidden',
      },
      // No Appeal raised → Appeal Review has nothing to show, not even to
      // Controls.
      appealReview: {
        controls: 'hidden',
      },
    },
    c,
    cfg
  );
});

test('matrix — Completed Case, responsiblePartyManager raiser, open Appeal', () => {
  const cfg = makeConfig({
    appeal: { raisedBy: 'responsiblePartyManager' },
  });
  const c = makeCase({ status: 'Completed', appeals: [openAppeal()] });
  // Matrix policy, for the reason given above: with the switch off, both Appeal
  // Sections are `hidden` to every role through `evaluateAccess`.
  assertMatrixGrid(
    {
      // The RP Manager is the configured raiser → edit on Appeal Request.
      appealRequest: {
        responsiblePartyManager: 'edit',
        journeyOwner: 'hidden',
      },
      // Open Appeal + Completed → Controls resolves (edit); every other role is
      // hidden, and Controls reads the Appeal's contents here rather than on
      // the Appeal Request tab.
      appealReview: {
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
