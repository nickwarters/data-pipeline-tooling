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

// --- resolveRoles ---

test('resolveRoles: assigned reviewer', () => {
  const caps = {
    isReviewer: true,
    ownedCaseTypes: [],
    isResponsibleParty: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isQaReviewer: false,
    isVisitor: false,
  };
  const roles = resolveRoles(makeCase(), 'user-reviewer', caps);
  assert.deepEqual(roles.sort(), ['assignedReviewer']);
});

test('resolveRoles: other reviewer (in group but not assigned)', () => {
  const caps = {
    isReviewer: true,
    ownedCaseTypes: [],
    isResponsibleParty: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isQaReviewer: false,
    isVisitor: false,
  };
  const roles = resolveRoles(makeCase(), 'user-other', caps);
  assert.deepEqual(roles, ['otherReviewer']);
});

test('resolveRoles: responsible party', () => {
  const caps = {
    isReviewer: false,
    ownedCaseTypes: [],
    isResponsibleParty: true,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isQaReviewer: false,
    isVisitor: false,
  };
  const roles = resolveRoles(makeCase(), 'user-rp', caps);
  assert.deepEqual(roles, ['responsibleParty']);
});

test('resolveRoles: case type owner', () => {
  const caps = {
    isReviewer: false,
    ownedCaseTypes: ['example-review'],
    isResponsibleParty: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isQaReviewer: false,
    isVisitor: false,
  };
  const roles = resolveRoles(makeCase(), 'user-owner', caps);
  assert.deepEqual(roles, ['caseTypeOwner']);
});

test('resolveRoles: none', () => {
  const caps = {
    isReviewer: false,
    ownedCaseTypes: [],
    isResponsibleParty: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isQaReviewer: false,
    isVisitor: false,
  };
  const roles = resolveRoles(makeCase(), 'stranger', caps);
  assert.deepEqual(roles, ['none']);
});

test('resolveRoles: multiple roles — assigned reviewer + owner', () => {
  const caps = {
    isReviewer: true,
    ownedCaseTypes: ['example-review'],
    isResponsibleParty: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isQaReviewer: false,
    isVisitor: false,
  };
  const roles = resolveRoles(makeCase(), 'user-reviewer', caps);
  assert.deepEqual(roles.sort(), ['assignedReviewer', 'caseTypeOwner']);
});

test('resolveRoles: other reviewer + RP (case where reviewer is also the RP for someone else? edge)', () => {
  // userId is RP of this case AND in reviewer group but not the assigned one.
  const caps = {
    isReviewer: true,
    ownedCaseTypes: [],
    isResponsibleParty: true,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isQaReviewer: false,
    isVisitor: false,
  };
  const roles = resolveRoles(makeCase(), 'user-rp', caps);
  assert.deepEqual(roles.sort(), ['otherReviewer', 'responsibleParty']);
});

test('resolveRoles: owner of a different case type does not get owner role', () => {
  const caps = {
    isReviewer: false,
    ownedCaseTypes: ['other-case-type'],
    isResponsibleParty: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isQaReviewer: false,
    isVisitor: false,
  };
  const roles = resolveRoles(makeCase(), 'user-x', caps);
  assert.deepEqual(roles, ['none']);
});

// --- Appeal Section + Responsible Party Manager role (issue #132) ---

test('resolveRoles: responsible party manager (matched via the row field)', () => {
  const caps = {
    isReviewer: false,
    ownedCaseTypes: [],
    isResponsibleParty: false,
    isReviewerManager: false,
    isResponsiblePartyManager: true,
    isMaintainer: false,
    isQaReviewer: false,
    isVisitor: false,
  };
  const roles = resolveRoles(
    makeCase({ responsiblePartyManager: 'user-rpm' }),
    'user-rpm',
    caps
  );
  assert.deepEqual(roles, ['responsiblePartyManager']);
});

test('resolveRoles: not the case row manager → no responsiblePartyManager role', () => {
  const caps = {
    isReviewer: false,
    ownedCaseTypes: [],
    isResponsibleParty: false,
    isReviewerManager: false,
    isResponsiblePartyManager: true,
    isMaintainer: false,
    isQaReviewer: false,
    isVisitor: false,
  };
  const roles = resolveRoles(
    makeCase({ responsiblePartyManager: 'someone-else' }),
    'user-rpm',
    caps
  );
  assert.deepEqual(roles, ['none']);
});

test('SECTIONS includes appeal', () => {
  assert.ok(SECTIONS.includes('appeal'));
});

test('evaluateAccess: appeal — RP and RP-Manager edit only once Completed, else hidden', () => {
  const cfg = makeConfig();
  for (const role of /** @type {const} */ ([
    'responsibleParty',
    'responsiblePartyManager',
  ])) {
    assert.equal(
      evaluateAccess(
        'appeal',
        [role],
        makeCase({ status: 'In-progress' }),
        cfg
      ),
      'hidden',
      `${role} cannot appeal an In-progress Case`
    );
    assert.equal(
      evaluateAccess('appeal', [role], makeCase({ status: 'Completed' }), cfg),
      'edit',
      `${role} can raise an Appeal on a Completed Case`
    );
  }
});

test('evaluateAccess: appeal — reviewers and owner are read-only; none is hidden', () => {
  const cfg = makeConfig();
  const c = makeCase({ status: 'Completed' });
  assert.equal(
    evaluateAccess('appeal', ['assignedReviewer'], c, cfg),
    'read-only'
  );
  assert.equal(
    evaluateAccess('appeal', ['otherReviewer'], c, cfg),
    'read-only'
  );
  assert.equal(
    evaluateAccess('appeal', ['caseTypeOwner'], c, cfg),
    'read-only'
  );
  assert.equal(evaluateAccess('appeal', ['none'], c, cfg), 'hidden');
});

test('evaluateAccess: appeal never resolves to edit for reviewers/owner even when Completed', () => {
  const cfg = makeConfig();
  const c = makeCase({ status: 'Completed' });
  for (const role of /** @type {const} */ ([
    'assignedReviewer',
    'otherReviewer',
    'caseTypeOwner',
  ])) {
    assert.notEqual(
      evaluateAccess('appeal', [role], c, cfg),
      'edit',
      `appeal must never be edit for ${role}`
    );
  }
});

test('evaluateAccess: responsiblePartyManager — read-only on details/questions/remediation, hidden on conversation/notes', () => {
  const cfg = makeConfig();
  const c = makeCase({ status: 'Completed' });
  assert.equal(
    evaluateAccess('details', ['responsiblePartyManager'], c, cfg),
    'read-only'
  );
  assert.equal(
    evaluateAccess('questions', ['responsiblePartyManager'], c, cfg),
    'read-only'
  );
  assert.equal(
    evaluateAccess('remediation', ['responsiblePartyManager'], c, cfg),
    'read-only'
  );
  assert.equal(
    evaluateAccess('conversation', ['responsiblePartyManager'], c, cfg),
    'hidden'
  );
  assert.equal(
    evaluateAccess('notes', ['responsiblePartyManager'], c, cfg),
    'hidden'
  );
});

test('evaluateAccess: responsiblePartyManager summary — hidden while in-progress, read-only when completed', () => {
  const cfg = makeConfig();
  assert.equal(
    evaluateAccess(
      'summary',
      ['responsiblePartyManager'],
      makeCase({ status: 'In-progress' }),
      cfg
    ),
    'hidden'
  );
  assert.equal(
    evaluateAccess(
      'summary',
      ['responsiblePartyManager'],
      makeCase({ status: 'Completed' }),
      cfg
    ),
    'read-only'
  );
});

// --- evaluateAccess: default matrix ---

test('evaluateAccess: assigned reviewer gets edit on all editable sections', () => {
  const cfg = makeConfig();
  const c = makeCase();
  assert.equal(
    evaluateAccess('questions', ['assignedReviewer'], c, cfg),
    'edit'
  );
  assert.equal(
    evaluateAccess('conversation', ['assignedReviewer'], c, cfg),
    'edit'
  );
  assert.equal(evaluateAccess('notes', ['assignedReviewer'], c, cfg), 'edit');
  assert.equal(
    evaluateAccess('remediation', ['assignedReviewer'], c, cfg),
    'edit'
  );
  assert.equal(
    evaluateAccess('summary', ['assignedReviewer'], c, cfg),
    'read-only'
  );
});

test('evaluateAccess: other reviewer is read-only everywhere', () => {
  const cfg = makeConfig();
  const c = makeCase();
  for (const s of SECTIONS) {
    assert.equal(
      evaluateAccess(s, ['otherReviewer'], c, cfg),
      'read-only',
      `section ${s}`
    );
  }
});

test('evaluateAccess: responsible party — questions R, conversation E, notes H, remediation R', () => {
  const cfg = makeConfig();
  const c = makeCase();
  assert.equal(
    evaluateAccess('questions', ['responsibleParty'], c, cfg),
    'read-only'
  );
  assert.equal(
    evaluateAccess('conversation', ['responsibleParty'], c, cfg),
    'edit'
  );
  assert.equal(evaluateAccess('notes', ['responsibleParty'], c, cfg), 'hidden');
  assert.equal(
    evaluateAccess('remediation', ['responsibleParty'], c, cfg),
    'read-only'
  );
});

test('evaluateAccess: RP summary — hidden while in-progress, read-only when completed', () => {
  const cfg = makeConfig();
  assert.equal(
    evaluateAccess(
      'summary',
      ['responsibleParty'],
      makeCase({ status: 'In-progress' }),
      cfg
    ),
    'hidden'
  );
  assert.equal(
    evaluateAccess(
      'summary',
      ['responsibleParty'],
      makeCase({ status: 'Completed' }),
      cfg
    ),
    'read-only'
  );
});

test('SECTIONS includes summary and no longer includes outcome', () => {
  assert.ok(SECTIONS.includes('summary'));
  assert.ok(!(/** @type {string[]} */ (SECTIONS).includes('outcome')));
});

test('evaluateAccess: summary never resolves to edit for any role', () => {
  const cfg = makeConfig();
  /** @type {import('../src/services/section-access.js').Role[]} */
  const roles = [
    'assignedReviewer',
    'otherReviewer',
    'responsibleParty',
    'caseTypeOwner',
    'none',
  ];
  for (const role of roles) {
    for (const status of /** @type {const} */ (['In-progress', 'Completed'])) {
      assert.notEqual(
        evaluateAccess('summary', [role], makeCase({ status }), cfg),
        'edit',
        `summary must never be edit for ${role} (${status})`
      );
    }
  }
});

test('evaluateAccess: case type owner read-only across the board', () => {
  const cfg = makeConfig();
  const c = makeCase();
  for (const s of SECTIONS) {
    assert.equal(
      evaluateAccess(s, ['caseTypeOwner'], c, cfg),
      'read-only',
      `section ${s}`
    );
  }
});

test('evaluateAccess: none role → hidden everywhere', () => {
  const cfg = makeConfig();
  const c = makeCase();
  for (const s of SECTIONS) {
    assert.equal(evaluateAccess(s, ['none'], c, cfg), 'hidden', `section ${s}`);
  }
});

// --- Most-permissive wins ---

test('evaluateAccess: most-permissive wins (RP + assignedReviewer → edit on notes)', () => {
  const cfg = makeConfig();
  const c = makeCase();
  assert.equal(
    evaluateAccess('notes', ['responsibleParty', 'assignedReviewer'], c, cfg),
    'edit'
  );
});

test('evaluateAccess: most-permissive wins (otherReviewer + RP → conversation edit)', () => {
  const cfg = makeConfig();
  const c = makeCase();
  assert.equal(
    evaluateAccess(
      'conversation',
      ['otherReviewer', 'responsibleParty'],
      c,
      cfg
    ),
    'edit'
  );
});

test('evaluateAccess: most-permissive wins (otherReviewer + RP → notes read-only beats hidden)', () => {
  const cfg = makeConfig();
  const c = makeCase();
  assert.equal(
    evaluateAccess('notes', ['otherReviewer', 'responsibleParty'], c, cfg),
    'read-only'
  );
});

// --- Case Details: read-only for every real role, never hidden per-role ---

test('SECTIONS includes details', () => {
  assert.ok(SECTIONS.includes('details'));
});

test('evaluateAccess: details is read-only for every real role and never hidden', () => {
  const cfg = makeConfig();
  /** @type {import('../src/services/section-access.js').Role[]} */
  const realRoles = [
    'assignedReviewer',
    'otherReviewer',
    'responsibleParty',
    'caseTypeOwner',
  ];
  for (const role of realRoles) {
    assert.equal(
      evaluateAccess(
        'details',
        [role],
        makeCase({ status: 'In-progress' }),
        cfg
      ),
      'read-only',
      `role ${role} in-progress`
    );
    assert.equal(
      evaluateAccess('details', [role], makeCase({ status: 'Completed' }), cfg),
      'read-only',
      `role ${role} completed`
    );
  }
});

test('evaluateAccess: details is hidden for the none role', () => {
  const cfg = makeConfig();
  assert.equal(evaluateAccess('details', ['none'], makeCase(), cfg), 'hidden');
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

test('evaluateAccess: a section present in the config object (membership) keeps its role-based mode', () => {
  const cfg = makeConfig({ sections: { notes: { showInSummary: true } } });
  const c = makeCase();
  assert.equal(evaluateAccess('notes', ['assignedReviewer'], c, cfg), 'edit');
});

test('evaluateAccess: sections undefined → defaults to all enabled', () => {
  const cfg = makeConfig();
  const c = makeCase();
  assert.equal(
    evaluateAccess('conversation', ['assignedReviewer'], c, cfg),
    'edit'
  );
});

// --- showInSummary (ADR-0016) ---

test('SUMMARY_SECTIONS lists the Sections that can appear as Summary blocks (not conversation/summary)', () => {
  assert.deepEqual(
    [...SUMMARY_SECTIONS],
    ['details', 'questions', 'remediation', 'notes']
  );
});

test('showInSummary: defaults — notes off, every other block Section on, when sections undefined', () => {
  const cfg = makeConfig();
  assert.equal(showInSummary('details', cfg), true);
  assert.equal(showInSummary('questions', cfg), true);
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
  // present with no explicit flag → default (questions → true)
  assert.equal(showInSummary('questions', cfg), true);
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

// --- QA Reviewer role + Answer Override Mode (issue #133, ADR-0018) ---

/** @returns {Capabilities} */
function qaCaps(extra = {}) {
  return {
    isReviewer: false,
    ownedCaseTypes: [],
    isResponsibleParty: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isQaReviewer: true,
    isVisitor: false,
    ...extra,
  };
}

test('resolveRoles: QA Reviewer capability → qaReviewer role', () => {
  const roles = resolveRoles(makeCase(), 'user-qa', qaCaps());
  assert.deepEqual(roles, ['qaReviewer']);
});

test('resolveRoles: assigned reviewer who is also a QA Reviewer gets both roles', () => {
  const roles = resolveRoles(
    makeCase(),
    'user-reviewer',
    qaCaps({ isReviewer: true })
  );
  assert.deepEqual(roles.sort(), ['assignedReviewer', 'qaReviewer']);
});

test('evaluateAccess: questions/remediation are override for a QA Reviewer on a Completed Case', () => {
  const cfg = makeConfig();
  const c = makeCase({ status: 'Completed' });
  assert.equal(evaluateAccess('questions', ['qaReviewer'], c, cfg), 'override');
  assert.equal(
    evaluateAccess('remediation', ['qaReviewer'], c, cfg),
    'override'
  );
});

test('evaluateAccess: questions/remediation are read-only for a QA Reviewer while In-progress', () => {
  const cfg = makeConfig();
  const c = makeCase({ status: 'In-progress' });
  assert.equal(
    evaluateAccess('questions', ['qaReviewer'], c, cfg),
    'read-only'
  );
  assert.equal(
    evaluateAccess('remediation', ['qaReviewer'], c, cfg),
    'read-only'
  );
});

test('evaluateAccess: QA Reviewer observes details/summary read-only, conversation/notes hidden', () => {
  const cfg = makeConfig();
  const c = makeCase({ status: 'Completed' });
  assert.equal(evaluateAccess('details', ['qaReviewer'], c, cfg), 'read-only');
  assert.equal(evaluateAccess('summary', ['qaReviewer'], c, cfg), 'read-only');
  assert.equal(
    evaluateAccess('conversation', ['qaReviewer'], c, cfg),
    'hidden'
  );
  assert.equal(evaluateAccess('notes', ['qaReviewer'], c, cfg), 'hidden');
});

test('evaluateAccess: appeal is edit for a QA Reviewer on a Completed Case (resolution path)', () => {
  const cfg = makeConfig();
  const c = makeCase({ status: 'Completed' });
  // The QA Reviewer resolves Appeals (issue #134); read-only while In-progress
  // (nothing to appeal yet).
  assert.equal(evaluateAccess('appeal', ['qaReviewer'], c, cfg), 'edit');
});

test('evaluateAccess: appeal is read-only for a QA Reviewer while In-progress', () => {
  const cfg = makeConfig();
  const c = makeCase({ status: 'In-progress' });
  assert.equal(evaluateAccess('appeal', ['qaReviewer'], c, cfg), 'read-only');
});

test('evaluateAccess: override Mode ranks between read-only and edit — edit still wins', () => {
  const cfg = makeConfig();
  const c = makeCase({ status: 'Completed' });
  // A QA Reviewer who is also the Assigned Reviewer: edit beats override.
  assert.equal(
    evaluateAccess('questions', ['qaReviewer', 'assignedReviewer'], c, cfg),
    'edit'
  );
  // override beats a plain read-only role.
  assert.equal(
    evaluateAccess('questions', ['qaReviewer', 'otherReviewer'], c, cfg),
    'override'
  );
});
