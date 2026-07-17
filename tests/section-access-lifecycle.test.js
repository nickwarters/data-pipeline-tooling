// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCase,
  makeConfig,
  makeActionsConfig,
  makeCaseWithActions,
  openAppeal,
  resolvedAppeal,
  evaluateAccess,
  SECTIONS,
} from './helpers/section-access.js';

// Capability: status transitions and most-permissive role composition.

// --- Appeal-config-conditional and status-conditional edge cells ---

test('appealRequest: default config (no appeal block) routes raising to the RP Manager', () => {
  // Exercises the `appealRaiser` default (`?? responsiblePartyManager`).
  const cfg = makeConfig();
  const c = makeCase({ status: 'Completed' });
  assert.equal(
    evaluateAccess('appealRequest', ['responsiblePartyManager'], c, cfg),
    'edit'
  );
  assert.equal(
    evaluateAccess('appealRequest', ['journeyOwner'], c, cfg),
    'read-only'
  );
});

test('appealRequest: raiser gets edit only once Completed, hidden/read-only before', () => {
  const rpmCfg = makeConfig({
    appeal: { raisedBy: 'responsiblePartyManager', resolvedBy: 'controls' },
  });
  assert.equal(
    evaluateAccess(
      'appealRequest',
      ['responsiblePartyManager'],
      makeCase({ status: 'Actions In Progress' }),
      rpmCfg
    ),
    'hidden'
  );
  const joCfg = makeConfig({
    appeal: { raisedBy: 'journeyOwner', resolvedBy: 'controls' },
  });
  assert.equal(
    evaluateAccess(
      'appealRequest',
      ['journeyOwner'],
      makeCase({ status: 'Actions In Progress' }),
      joCfg
    ),
    'read-only'
  );
});

test('appealReview: Controls edits only while an Appeal is open on a Completed Case', () => {
  const cfg = makeConfig();
  // Completed, appeals all resolved → read-only (no open appeal).
  assert.equal(
    evaluateAccess(
      'appealReview',
      ['controls'],
      makeCase({ status: 'Completed', appeals: [resolvedAppeal()] }),
      cfg
    ),
    'read-only'
  );
  // Completed, open appeal → edit.
  assert.equal(
    evaluateAccess(
      'appealReview',
      ['controls'],
      makeCase({ status: 'Completed', appeals: [openAppeal()] }),
      cfg
    ),
    'edit'
  );
  // Not Completed → read-only even with an open appeal.
  assert.equal(
    evaluateAccess(
      'appealReview',
      ['controls'],
      makeCase({ status: 'Actions In Progress', appeals: [openAppeal()] }),
      cfg
    ),
    'read-only'
  );
});

test('amendOutcome: Controls edits on Completed, hidden otherwise', () => {
  const cfg = makeConfig();
  assert.equal(
    evaluateAccess(
      'amendOutcome',
      ['controls'],
      makeCase({ status: 'Completed' }),
      cfg
    ),
    'edit'
  );
  assert.equal(
    evaluateAccess(
      'amendOutcome',
      ['controls'],
      makeCase({ status: 'In-progress' }),
      cfg
    ),
    'hidden'
  );
});

test('summary: RP reportable-gated, RP Manager Completed-gated (ADR-0011 amend / ADR-0023)', () => {
  const cfg = makeConfig();
  // Actions In Progress: Adviser reads it; their Manager does not yet.
  const actions = makeCase({ status: 'Actions In Progress' });
  assert.equal(
    evaluateAccess('summary', ['responsibleParty'], actions, cfg),
    'read-only'
  );
  assert.equal(
    evaluateAccess('summary', ['responsiblePartyManager'], actions, cfg),
    'hidden'
  );
  // Completed: both read it.
  const completed = makeCase({ status: 'Completed' });
  assert.equal(
    evaluateAccess('summary', ['responsibleParty'], completed, cfg),
    'read-only'
  );
  assert.equal(
    evaluateAccess('summary', ['responsiblePartyManager'], completed, cfg),
    'read-only'
  );
});

test('questions/issues: reviewer edits until reportable, then read-only', () => {
  const cfg = makeConfig();
  for (const section of /** @type {const} */ (['questions', 'issues'])) {
    assert.equal(
      evaluateAccess(
        section,
        ['assignedReviewer'],
        makeCase({ status: 'In-progress' }),
        cfg
      ),
      'edit'
    );
    assert.equal(
      evaluateAccess(
        section,
        ['assignedReviewer'],
        makeCase({ status: 'Actions In Progress' }),
        cfg
      ),
      'read-only'
    );
    assert.equal(
      evaluateAccess(
        section,
        ['assignedReviewer'],
        makeCase({ status: 'Completed' }),
        cfg
      ),
      'read-only'
    );
  }
});

test('notes: reviewer edits until Completed, then read-only', () => {
  const cfg = makeConfig();
  assert.equal(
    evaluateAccess(
      'notes',
      ['assignedReviewer'],
      makeCase({ status: 'Actions In Progress' }),
      cfg
    ),
    'edit'
  );
  assert.equal(
    evaluateAccess(
      'notes',
      ['assignedReviewer'],
      makeCase({ status: 'Completed' }),
      cfg
    ),
    'read-only'
  );
});

// --- Remediation tracking visibility (ADR-0024) ---

test('remediation: hidden for every viewer until actions are sent', () => {
  const cfg = makeActionsConfig();
  const c = makeCase();
  for (const role of /** @type {const} */ ([
    'assignedReviewer',
    'otherReviewer',
    'responsibleParty',
    'responsiblePartyManager',
    'caseTypeOwner',
    'journeyOwner',
    'controls',
    'none',
  ])) {
    assert.equal(
      evaluateAccess('remediation', [role], c, cfg),
      'hidden',
      `remediation hidden for ${role} with no sent actions`
    );
  }
});

test('remediation: reviewer edits while Actions In Progress, read-only once Completed', () => {
  const cfg = makeActionsConfig();
  assert.equal(
    evaluateAccess(
      'remediation',
      ['assignedReviewer'],
      makeCaseWithActions({ status: 'Actions In Progress' }),
      cfg
    ),
    'edit'
  );
  assert.equal(
    evaluateAccess(
      'remediation',
      ['assignedReviewer'],
      makeCaseWithActions({ status: 'Completed' }),
      cfg
    ),
    'read-only'
  );
});

test('remediation: observers see read-only once actions are sent', () => {
  const cfg = makeActionsConfig();
  const c = makeCaseWithActions({ status: 'Actions In Progress' });
  for (const role of /** @type {const} */ ([
    'otherReviewer',
    'caseTypeOwner',
    'journeyOwner',
    'controls',
  ])) {
    assert.equal(
      evaluateAccess('remediation', [role], c, cfg),
      'read-only',
      role
    );
  }
});

// --- Acceptance statements (issue #234) ---

test('acceptance: the Adviser (Responsible Party) sees only Summary + Conversation', () => {
  const cfg = makeConfig();
  const c = makeCase({ status: 'Actions In Progress' });
  const visible = SECTIONS.filter(
    (s) => evaluateAccess(s, ['responsibleParty'], c, cfg) !== 'hidden'
  );
  assert.deepEqual(visible.sort(), ['conversation', 'summary']);
});

test('acceptance: Controls is the role that gets Appeal Review + Amend Outcome (edit)', () => {
  const cfg = makeConfig();
  const c = makeCase({ status: 'Completed', appeals: [openAppeal()] });
  assert.equal(evaluateAccess('appealReview', ['controls'], c, cfg), 'edit');
  assert.equal(evaluateAccess('amendOutcome', ['controls'], c, cfg), 'edit');
});

// --- Most-permissive wins across a viewer's roles ---

test('most-permissive: RP + assignedReviewer → edit on notes', () => {
  const cfg = makeConfig();
  assert.equal(
    evaluateAccess(
      'notes',
      ['responsibleParty', 'assignedReviewer'],
      makeCase(),
      cfg
    ),
    'edit'
  );
});

test('most-permissive: role order cannot let a later hidden role reduce access', () => {
  const cfg = makeConfig();
  assert.equal(
    evaluateAccess(
      'notes',
      ['assignedReviewer', 'responsibleParty'],
      makeCase(),
      cfg
    ),
    'edit'
  );
});

test('most-permissive: otherReviewer + RP → conversation edit', () => {
  const cfg = makeConfig();
  assert.equal(
    evaluateAccess(
      'conversation',
      ['otherReviewer', 'responsibleParty'],
      makeCase(),
      cfg
    ),
    'edit'
  );
});

test('most-permissive: Controls user who is also the Assigned Reviewer still edits questions', () => {
  const cfg = makeConfig();
  const c = makeCase({ status: 'In-progress' });
  assert.equal(
    evaluateAccess('questions', ['controls', 'assignedReviewer'], c, cfg),
    'edit'
  );
  // Two read-only roles stay read-only.
  assert.equal(
    evaluateAccess('questions', ['controls', 'otherReviewer'], c, cfg),
    'read-only'
  );
});
