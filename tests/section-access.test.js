// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAccess,
  resolveRoles,
  showInSummary,
  SECTIONS,
  SUMMARY_SECTIONS,
} from '../src/services/section-access.js';

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/services/permissions.js').Capabilities} Capabilities */
/** @typedef {import('../src/services/section-access.js').Section} Section */
/** @typedef {import('../src/services/section-access.js').Role} Role */
/** @typedef {import('../src/services/section-access.js').Mode} Mode */

/** @returns {CaseRow} */
function makeCase(overrides = {}) {
  return {
    id: 'case-1',
    caseType: 'example-review',
    title: 'T',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'W/"1"',
    ...overrides,
  };
}

/** @returns {CaseTypeConfig} */
function makeConfig(overrides = {}) {
  return {
    questions: [],
    computeOutcome: () => ({ outcome: 'pass' }),
    ...overrides,
  };
}

/**
 * A config declaring one `actions`-typed Issue Capture Field, so the Remediation
 * *tracking* Section (ADR-0024) can become visible.
 * @returns {CaseTypeConfig}
 */
function makeActionsConfig(overrides = {}) {
  return makeConfig({
    captureGroups: [
      {
        key: 'g',
        label: 'G',
        fields: [{ key: 'acts', label: 'Actions', type: 'actions' }],
      },
    ],
    ...overrides,
  });
}

/**
 * A Case carrying one sent Remediation Action, so `hasSentActions` is true and the
 * Remediation tracking Section is not hidden.
 * @param {Partial<CaseRow>} [overrides]
 * @returns {CaseRow}
 */
function makeCaseWithActions(overrides = {}) {
  return makeCase({
    answers: {
      q1: {
        value: 'No',
        capture: { acts: [{ id: 'a', text: 'do', status: 'pending' }] },
      },
    },
    ...overrides,
  });
}

/** @returns {import('../src/sharepoint-client.js').Appeal} */
function openAppeal() {
  return {
    id: 'ap1',
    appellant: 'someone',
    at: '2026-07-01T00:00:00Z',
    rationale: 'wrong outcome',
    state: 'raised',
  };
}

/** @returns {import('../src/sharepoint-client.js').Appeal} */
function resolvedAppeal() {
  return { ...openAppeal(), state: 'resolved' };
}

/**
 * Build a Capabilities object with everything off by default.
 * @param {Partial<Capabilities>} [overrides]
 * @returns {Capabilities}
 */
function caps(overrides = {}) {
  return {
    isReviewer: false,
    listAccessCaseTypes: [],
    isAdviser: false,
    ownedCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isVisitor: false,
    ...overrides,
  };
}

// --- resolveRoles ---

test('resolveRoles: assigned reviewer', () => {
  const roles = resolveRoles(
    makeCase(),
    'user-reviewer',
    caps({ isReviewer: true })
  );
  assert.deepEqual(roles, ['assignedReviewer']);
});

test('resolveRoles: other reviewer (in group but not assigned)', () => {
  const roles = resolveRoles(
    makeCase(),
    'user-other',
    caps({ isReviewer: true })
  );
  assert.deepEqual(roles, ['otherReviewer']);
});

test('resolveRoles: responsible party (the Adviser named on the Case)', () => {
  const roles = resolveRoles(makeCase(), 'user-rp', caps({ isAdviser: true }));
  assert.deepEqual(roles, ['responsibleParty']);
});

test('resolveRoles: case type owner', () => {
  const roles = resolveRoles(
    makeCase(),
    'user-owner',
    caps({ ownedCaseTypes: ['example-review'] })
  );
  assert.deepEqual(roles, ['caseTypeOwner']);
});

test('resolveRoles: journey owner (from ownedJourneyCaseTypes, ADR-0027)', () => {
  const roles = resolveRoles(
    makeCase(),
    'user-jo',
    caps({ ownedJourneyCaseTypes: ['example-review'] })
  );
  assert.deepEqual(roles, ['journeyOwner']);
});

test('resolveRoles: journey owner of a different case type does not get the role', () => {
  const roles = resolveRoles(
    makeCase(),
    'user-jo',
    caps({ ownedJourneyCaseTypes: ['other-type'] })
  );
  assert.deepEqual(roles, ['none']);
});

test('resolveRoles: none', () => {
  const roles = resolveRoles(makeCase(), 'stranger', caps());
  assert.deepEqual(roles, ['none']);
});

test('resolveRoles: multiple roles — assigned reviewer + owner + journey owner', () => {
  const roles = resolveRoles(
    makeCase(),
    'user-reviewer',
    caps({
      isReviewer: true,
      ownedCaseTypes: ['example-review'],
      ownedJourneyCaseTypes: ['example-review'],
    })
  );
  assert.deepEqual(roles.sort(), [
    'assignedReviewer',
    'caseTypeOwner',
    'journeyOwner',
  ]);
});

test('resolveRoles: other reviewer + RP (userId is RP and in reviewer group but not assigned)', () => {
  const roles = resolveRoles(
    makeCase(),
    'user-rp',
    caps({ isReviewer: true, isAdviser: true })
  );
  assert.deepEqual(roles.sort(), ['otherReviewer', 'responsibleParty']);
});

test('resolveRoles: owner of a different case type does not get owner role', () => {
  const roles = resolveRoles(
    makeCase(),
    'user-x',
    caps({ ownedCaseTypes: ['other-case-type'] })
  );
  assert.deepEqual(roles, ['none']);
});

test('resolveRoles: responsible party manager (matched via the row field)', () => {
  const roles = resolveRoles(
    makeCase({ responsiblePartyManager: 'user-rpm' }),
    'user-rpm',
    caps({ isResponsiblePartyManager: true })
  );
  assert.deepEqual(roles, ['responsiblePartyManager']);
});

test('resolveRoles: not the case row manager → no responsiblePartyManager role', () => {
  const roles = resolveRoles(
    makeCase({ responsiblePartyManager: 'someone-else' }),
    'user-rpm',
    caps({ isResponsiblePartyManager: true })
  );
  assert.deepEqual(roles, ['none']);
});

test('resolveRoles: Controls capability → controls role', () => {
  const roles = resolveRoles(
    makeCase(),
    'user-controls',
    caps({ isControls: true })
  );
  assert.deepEqual(roles, ['controls']);
});

test('resolveRoles: assigned reviewer who is also Controls gets both roles', () => {
  const roles = resolveRoles(
    makeCase(),
    'user-reviewer',
    caps({ isReviewer: true, isControls: true })
  );
  assert.deepEqual(roles.sort(), ['assignedReviewer', 'controls']);
});

// --- The Section set (ADR-0011 amend) ---

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

// --- Full matrix coverage: every ADR grid cell across representative states ---

/**
 * Assert `evaluateAccess` for every (section, role) pair in an expected grid.
 * @param {Partial<Record<Section, Partial<Record<Role, Mode>>>>} grid
 * @param {CaseRow} caseRow
 * @param {CaseTypeConfig} config
 */
function assertGrid(grid, caseRow, config) {
  for (const section of /** @type {Section[]} */ (Object.keys(grid))) {
    const row = grid[section];
    if (!row) continue;
    for (const role of /** @type {Role[]} */ (Object.keys(row))) {
      assert.equal(
        evaluateAccess(section, [role], caseRow, config),
        row[role],
        `${section} × ${role}`
      );
    }
  }
}

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
        responsiblePartyManager: 'hidden',
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
  const cfg = makeActionsConfig();
  const c = makeCaseWithActions({ status: 'Actions In Progress' });
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
      // Remediation tracking is now visible: reviewer edits, everyone else observes.
      remediation: {
        assignedReviewer: 'edit',
        otherReviewer: 'read-only',
        responsibleParty: 'hidden',
        responsiblePartyManager: 'hidden',
        caseTypeOwner: 'read-only',
        journeyOwner: 'read-only',
        controls: 'read-only',
        none: 'hidden',
      },
      // Notes stay editable for the reviewer until the Case is Completed.
      notes: {
        assignedReviewer: 'edit',
      },
      // Appeal/amend Sections remain Completed-only.
      appealRequest: {
        responsiblePartyManager: 'hidden',
        journeyOwner: 'read-only',
      },
      appealReview: { controls: 'read-only' },
      amendOutcome: { controls: 'hidden' },
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
      // every other role (ADR-0026, refined — observers read the Current Outcome
      // in the Summary, not this tab).
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

// --- none role ---

test('none role → hidden everywhere', () => {
  const cfg = makeActionsConfig();
  const c = makeCaseWithActions({
    status: 'Completed',
    appeals: [openAppeal()],
  });
  for (const s of SECTIONS) {
    assert.equal(evaluateAccess(s, ['none'], c, cfg), 'hidden', `section ${s}`);
  }
});

// --- Case Type opt-out (per-Section config object, ADR-0016) ---

test('evaluateAccess: section omitted from the sections config object → hidden regardless of role', () => {
  const cfg = makeConfig({
    sections: { questions: {}, remediation: {}, summary: {} },
  });
  const c = makeCase();
  assert.equal(
    evaluateAccess('conversation', ['assignedReviewer'], c, cfg),
    'hidden'
  );
  assert.equal(evaluateAccess('notes', ['assignedReviewer'], c, cfg), 'hidden');
  assert.equal(
    evaluateAccess('questions', ['assignedReviewer'], c, cfg),
    'edit'
  );
});

test('evaluateAccess: a section present in the config object keeps its role-based mode', () => {
  const cfg = makeConfig({ sections: { notes: { showInSummary: true } } });
  assert.equal(
    evaluateAccess('notes', ['assignedReviewer'], makeCase(), cfg),
    'edit'
  );
});

test('evaluateAccess: sections undefined → defaults to all enabled', () => {
  const cfg = makeConfig();
  assert.equal(
    evaluateAccess('conversation', ['assignedReviewer'], makeCase(), cfg),
    'edit'
  );
});

test('evaluateAccess: empty sections object → all hidden', () => {
  const cfg = makeConfig({ sections: {} });
  const c = makeCase();
  for (const s of SECTIONS) {
    assert.equal(
      evaluateAccess(s, ['assignedReviewer'], c, cfg),
      'hidden',
      `section ${s}`
    );
  }
});

// --- Conversation allowMessagesWhen ---

test('evaluateAccess: conversation allowMessagesWhen restricts to read-only for unlisted statuses', () => {
  const cfg = makeConfig({
    sections: { conversation: { allowMessagesWhen: ['Actions In Progress'] } },
  });
  const cInProgress = makeCase({ status: 'In-progress' });
  const cActions = makeCase({ status: 'Actions In Progress' });
  const cCompleted = makeCase({ status: 'Completed' });

  for (const role of /** @type {const} */ ([
    'assignedReviewer',
    'responsibleParty',
  ])) {
    assert.equal(
      evaluateAccess('conversation', [role], cInProgress, cfg),
      'read-only',
      role
    );
    assert.equal(
      evaluateAccess('conversation', [role], cActions, cfg),
      'edit',
      role
    );
    assert.equal(
      evaluateAccess('conversation', [role], cCompleted, cfg),
      'read-only',
      role
    );
  }
});

test('evaluateAccess: conversation without allowMessagesWhen defaults to edit', () => {
  const cfg = makeConfig({ sections: { conversation: {} } });
  const c = makeCase({ status: 'In-progress' });
  assert.equal(
    evaluateAccess('conversation', ['assignedReviewer'], c, cfg),
    'edit'
  );
  assert.equal(
    evaluateAccess('conversation', ['responsibleParty'], c, cfg),
    'edit'
  );
});

// --- showInSummary (ADR-0016) ---

test('SUMMARY_SECTIONS lists the Sections that can appear as Summary blocks', () => {
  assert.deepEqual(
    [...SUMMARY_SECTIONS],
    ['details', 'questions', 'issues', 'remediation', 'notes']
  );
});

test('showInSummary: defaults — notes off, every other block Section on, when sections undefined', () => {
  const cfg = makeConfig();
  assert.equal(showInSummary('details', cfg), true);
  assert.equal(showInSummary('questions', cfg), true);
  assert.equal(showInSummary('issues', cfg), true);
  assert.equal(showInSummary('remediation', cfg), true);
  assert.equal(showInSummary('notes', cfg), false);
});

test('showInSummary: explicit flag overrides the default', () => {
  const cfg = makeConfig({
    sections: {
      notes: { showInSummary: true },
      questions: { showInSummary: false },
    },
  });
  assert.equal(showInSummary('notes', cfg), true);
  assert.equal(showInSummary('questions', cfg), false);
});

test('showInSummary: a Section absent from the config object is never in Summary', () => {
  const cfg = makeConfig({ sections: { questions: {} } });
  assert.equal(showInSummary('details', cfg), false);
  assert.equal(showInSummary('notes', cfg), false);
  assert.equal(showInSummary('questions', cfg), true);
});
