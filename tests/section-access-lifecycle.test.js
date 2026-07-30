// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCase,
  makeConfig,
  makeCaseWithRemediation,
  CATALOGUE,
  remediationAudience,
  openAppeal,
  resolvedAppeal,
  evaluateAccess,
  SECTIONS,
} from './helpers/section-access.js';
import { MATRIX } from '../src/services/section-access.js';

/** @typedef {import('../src/services/section-access.js').Role} Role */

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

test('appealReview: Controls gets no tab before the first Appeal, then edit while open, then read-only', () => {
  const cfg = makeConfig();
  // No Appeal has ever been raised → no tab at all: the Section would render an
  // empty resolution history.
  assert.equal(
    evaluateAccess(
      'appealReview',
      ['controls'],
      makeCase({ status: 'Completed' }),
      cfg
    ),
    'hidden',
    'Completed with no Appeal'
  );
  // Resolved Appeal → read-only, so Controls can read back their own resolution.
  assert.equal(
    evaluateAccess(
      'appealReview',
      ['controls'],
      makeCase({ status: 'Completed', appeals: [resolvedAppeal()] }),
      cfg
    ),
    'read-only',
    'Completed with a resolved Appeal'
  );
  // Open Appeal on a Completed Case → the resolution form.
  assert.equal(
    evaluateAccess(
      'appealReview',
      ['controls'],
      makeCase({ status: 'Completed', appeals: [openAppeal()] }),
      cfg
    ),
    'edit',
    'Completed with an open Appeal'
  );
  // An open Appeal on a Case that is not Completed cannot arise from the flow,
  // so it means inconsistent data: show the history, withhold the form.
  assert.equal(
    evaluateAccess(
      'appealReview',
      ['controls'],
      makeCase({ status: 'Actions In Progress', appeals: [openAppeal()] }),
      cfg
    ),
    'read-only',
    'open Appeal on a non-Completed Case fails closed to read-only'
  );
});

test('amendOutcome: Controls edits once the Case is reportable, hidden before', () => {
  const cfg = makeConfig();
  assert.equal(
    evaluateAccess(
      'amendOutcome',
      ['controls'],
      makeCase({ status: 'Actions In Progress' }),
      cfg
    ),
    'edit'
  );
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

test('summary: RP reportable-gated, RP Manager Completed-gated', () => {
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

// --- Remediation tracking visibility ---

test('remediation: hidden for every viewer until actions are sent', () => {
  const cfg = makeConfig();
  const c = makeCase();
  for (const role of /** @type {const} */ ([
    'assignedReviewer',
    'otherReviewer',
    'reviewerManager',
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

// --- Acceptance statements ---

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

// --- Remediation: question-level rows and the two audiences ---

test('remediation: hidden while In-progress even though the Reviewer has attached actions', () => {
  const cfg = makeConfig();
  const c = makeCaseWithRemediation({ status: 'In-progress' });
  for (const role of /** @type {const} */ ([
    'assignedReviewer',
    'reviewerManager',
    'responsibleParty',
    'responsiblePartyManager',
    'journeyOwner',
    'controls',
  ])) {
    assert.equal(evaluateAccess('remediation', [role], c, cfg), 'hidden', role);
  }
});

test('remediation: visible from question-level remediation, with no actions-typed capture field declared', () => {
  // The store is `answer.remediationActions` (what the Issues tab writes), not
  // an `actions`-typed Issue Capture Field — no Case Type declares one.
  const cfg = makeConfig();
  assert.equal(cfg.captureGroups, undefined);
  assert.equal(
    evaluateAccess(
      'remediation',
      ['assignedReviewer'],
      makeCaseWithRemediation({ status: 'Actions In Progress' }),
      cfg
    ),
    'edit'
  );
});

test('remediation: free-form remediation alone makes the Section visible', () => {
  const cfg = makeConfig();
  const c = makeCase({
    status: 'Actions In Progress',
    answers: { q1: { value: 'No', freeFormRemediation: 'Write to customer' } },
  });
  assert.equal(
    evaluateAccess('remediation', ['assignedReviewer'], c, cfg),
    'edit'
  );
});

test('remediation: a failed Answer with no remediation keeps the Section hidden', () => {
  const cfg = makeConfig();
  const c = makeCase({
    status: 'Actions In Progress',
    answers: { q1: { value: 'No' } },
  });
  assert.equal(
    evaluateAccess('remediation', ['assignedReviewer'], c, cfg),
    'hidden'
  );
});

test('remediation: hidden when the remediation is on a Question that has left the catalogue', () => {
  // The gate and the tab's rows are the same question asked once. Reading the
  // Answers blob alone gave a strict superset, so a Case whose only remediation
  // was stranded on a deprecated (or newly inapplicable, or no-longer-failing)
  // Question opened a Remediation tab that rendered "No remediation actions
  // sent." beside its SLA date and, ten working days later, an Overdue badge.
  const cfg = makeConfig();
  const c = makeCaseWithRemediation({ status: 'Actions In Progress' });
  const deprecated = CATALOGUE.map((q) => ({ ...q, deprecated: true }));

  for (const catalogue of [deprecated, []]) {
    for (const role of /** @type {const} */ ([
      'assignedReviewer',
      'otherReviewer',
      'reviewerManager',
      'responsibleParty',
      'responsiblePartyManager',
      'journeyOwner',
      'controls',
    ])) {
      assert.equal(
        evaluateAccess('remediation', [role], c, cfg, catalogue),
        'hidden',
        role
      );
    }
  }
});

test('remediation: the reviewer-side audience observes read-only; only the Assigned Reviewer edits', () => {
  const cfg = makeConfig();
  const c = makeCaseWithRemediation({ status: 'Actions In Progress' });
  assert.equal(
    evaluateAccess('remediation', ['assignedReviewer'], c, cfg),
    'edit'
  );
  for (const role of /** @type {const} */ ([
    'otherReviewer',
    'reviewerManager',
    'caseTypeOwner',
    'controls',
  ])) {
    assert.equal(
      evaluateAccess('remediation', [role], c, cfg),
      'read-only',
      role
    );
  }
});

test('remediation: the responsible-party-side audience reads it once the Case is reportable', () => {
  const cfg = makeConfig();
  for (const role of /** @type {const} */ ([
    'responsibleParty',
    'responsiblePartyManager',
    'journeyOwner',
  ])) {
    assert.equal(
      evaluateAccess(
        'remediation',
        [role],
        makeCaseWithRemediation({ status: 'Actions In Progress' }),
        cfg
      ),
      'read-only',
      `${role} while Actions In Progress`
    );
    assert.equal(
      evaluateAccess(
        'remediation',
        [role],
        makeCaseWithRemediation({ status: 'Completed' }),
        cfg
      ),
      'read-only',
      `${role} once Completed`
    );
  }
});

test('remediation: the Assigned Reviewer freezes to read-only once Completed', () => {
  const cfg = makeConfig();
  assert.equal(
    evaluateAccess(
      'remediation',
      ['assignedReviewer'],
      makeCaseWithRemediation({ status: 'Completed' }),
      cfg
    ),
    'read-only'
  );
});

test('remediation: never visible to the none role', () => {
  assert.equal(
    evaluateAccess(
      'remediation',
      ['none'],
      makeCaseWithRemediation({ status: 'Actions In Progress' }),
      makeConfig()
    ),
    'hidden'
  );
});

// --- remediationAudience ---

test('remediationAudience: reviewer-side roles get the status controls', () => {
  for (const role of /** @type {const} */ ([
    'assignedReviewer',
    'otherReviewer',
    'reviewerManager',
    'caseTypeOwner',
    'controls',
  ])) {
    assert.equal(remediationAudience([role]), 'reviewer', role);
  }
});

test('remediationAudience: the party doing the work is pointed at the Conversation', () => {
  for (const role of /** @type {const} */ ([
    'responsibleParty',
    'responsiblePartyManager',
    'journeyOwner',
    'none',
  ])) {
    assert.equal(remediationAudience([role]), 'responsibleParty', role);
  }
});

test('remediationAudience: reviewer-side wins when a viewer holds both', () => {
  assert.equal(
    remediationAudience(['journeyOwner', 'assignedReviewer']),
    'reviewer'
  );
});

test('remediationAudience: every Role in the matrix is classified deliberately', () => {
  // `remediationAudience` is a second classification of the Role union living
  // outside MATRIX, and its fall-through is `responsibleParty` — so a Role added
  // later would silently pick a rendering nobody chose. That is the same class of
  // bug this feature exists to fix, so the Roles are enumerated here against the
  // matrix rather than by hand: adding one fails this test until it is listed.
  /** @type {Record<Role, 'reviewer' | 'responsibleParty'>} */
  const expected = {
    assignedReviewer: 'reviewer',
    otherReviewer: 'reviewer',
    reviewerManager: 'reviewer',
    caseTypeOwner: 'reviewer',
    controls: 'reviewer',
    responsibleParty: 'responsibleParty',
    responsiblePartyManager: 'responsibleParty',
    journeyOwner: 'responsibleParty',
    none: 'responsibleParty',
  };

  const roles = /** @type {Role[]} */ (Object.keys(MATRIX.remediation));
  assert.deepEqual(
    roles.slice().sort(),
    Object.keys(expected).sort(),
    'every Role with a Remediation cell is classified, and no more'
  );
  for (const role of roles) {
    assert.equal(remediationAudience([role]), expected[role], role);
  }
});

// --- Conversation: the Responsible Party Manager participates ---

test('conversation: the Responsible Party Manager posts, like the Responsible Party', () => {
  const cfg = makeConfig();
  for (const status of ['In-progress', 'Actions In Progress', 'Completed']) {
    assert.equal(
      evaluateAccess(
        'conversation',
        ['responsiblePartyManager'],
        makeCase({ status }),
        cfg
      ),
      'edit',
      status
    );
  }
});

test('conversation: the Manager reaching the Remediation tab has a Conversation to open', () => {
  // The responsible-party rendering points at the Conversation, so the roles it
  // covers must be able to see one.
  const cfg = makeConfig();
  const c = makeCaseWithRemediation({ status: 'Actions In Progress' });
  for (const role of /** @type {const} */ ([
    'responsibleParty',
    'responsiblePartyManager',
    'journeyOwner',
  ])) {
    assert.equal(evaluateAccess('remediation', [role], c, cfg), 'read-only');
    assert.notEqual(
      evaluateAccess('conversation', [role], c, cfg),
      'hidden',
      role
    );
  }
});
