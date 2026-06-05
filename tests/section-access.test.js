// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAccess, resolveRoles, SECTIONS } from '../src/services/section-access.js';

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/services/permissions.js').Capabilities} Capabilities */

/** @returns {CaseRow} */
function makeCase(overrides = {}) {
  return {
    id: 'case-1',
    caseType: 'hello-review',
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
    computeOutcome: () => ({ verdict: 'pass' }),
    ...overrides,
  };
}

// --- resolveRoles ---

test('resolveRoles: assigned reviewer', () => {
  const caps = { isReviewer: true, ownedCaseTypes: [], isResponsibleParty: false, isReviewerManager: false, isResponsiblePartyManager: false, isMaintainer: false, isVisitor: false };
  const roles = resolveRoles(makeCase(), 'user-reviewer', caps);
  assert.deepEqual(roles.sort(), ['assignedReviewer']);
});

test('resolveRoles: other reviewer (in group but not assigned)', () => {
  const caps = { isReviewer: true, ownedCaseTypes: [], isResponsibleParty: false, isReviewerManager: false, isResponsiblePartyManager: false, isMaintainer: false, isVisitor: false };
  const roles = resolveRoles(makeCase(), 'user-other', caps);
  assert.deepEqual(roles, ['otherReviewer']);
});

test('resolveRoles: responsible party', () => {
  const caps = { isReviewer: false, ownedCaseTypes: [], isResponsibleParty: true, isReviewerManager: false, isResponsiblePartyManager: false, isMaintainer: false, isVisitor: false };
  const roles = resolveRoles(makeCase(), 'user-rp', caps);
  assert.deepEqual(roles, ['responsibleParty']);
});

test('resolveRoles: case type owner', () => {
  const caps = { isReviewer: false, ownedCaseTypes: ['hello-review'], isResponsibleParty: false, isReviewerManager: false, isResponsiblePartyManager: false, isMaintainer: false, isVisitor: false };
  const roles = resolveRoles(makeCase(), 'user-owner', caps);
  assert.deepEqual(roles, ['caseTypeOwner']);
});

test('resolveRoles: none', () => {
  const caps = { isReviewer: false, ownedCaseTypes: [], isResponsibleParty: false, isReviewerManager: false, isResponsiblePartyManager: false, isMaintainer: false, isVisitor: false };
  const roles = resolveRoles(makeCase(), 'stranger', caps);
  assert.deepEqual(roles, ['none']);
});

test('resolveRoles: multiple roles — assigned reviewer + owner', () => {
  const caps = { isReviewer: true, ownedCaseTypes: ['hello-review'], isResponsibleParty: false, isReviewerManager: false, isResponsiblePartyManager: false, isMaintainer: false, isVisitor: false };
  const roles = resolveRoles(makeCase(), 'user-reviewer', caps);
  assert.deepEqual(roles.sort(), ['assignedReviewer', 'caseTypeOwner']);
});

test('resolveRoles: other reviewer + RP (case where reviewer is also the RP for someone else? edge)', () => {
  // userId is RP of this case AND in reviewer group but not the assigned one.
  const caps = { isReviewer: true, ownedCaseTypes: [], isResponsibleParty: true, isReviewerManager: false, isResponsiblePartyManager: false, isMaintainer: false, isVisitor: false };
  const roles = resolveRoles(makeCase(), 'user-rp', caps);
  assert.deepEqual(roles.sort(), ['otherReviewer', 'responsibleParty']);
});

test('resolveRoles: owner of a different case type does not get owner role', () => {
  const caps = { isReviewer: false, ownedCaseTypes: ['other-case-type'], isResponsibleParty: false, isReviewerManager: false, isResponsiblePartyManager: false, isMaintainer: false, isVisitor: false };
  const roles = resolveRoles(makeCase(), 'user-x', caps);
  assert.deepEqual(roles, ['none']);
});

// --- evaluateAccess: default matrix ---

test('evaluateAccess: assigned reviewer gets edit on all editable sections', () => {
  const cfg = makeConfig();
  const c = makeCase();
  assert.equal(evaluateAccess('questions', ['assignedReviewer'], c, cfg), 'edit');
  assert.equal(evaluateAccess('conversation', ['assignedReviewer'], c, cfg), 'edit');
  assert.equal(evaluateAccess('notes', ['assignedReviewer'], c, cfg), 'edit');
  assert.equal(evaluateAccess('remediation', ['assignedReviewer'], c, cfg), 'edit');
  assert.equal(evaluateAccess('outcome', ['assignedReviewer'], c, cfg), 'read-only');
});

test('evaluateAccess: other reviewer is read-only everywhere', () => {
  const cfg = makeConfig();
  const c = makeCase();
  for (const s of SECTIONS) {
    assert.equal(evaluateAccess(s, ['otherReviewer'], c, cfg), 'read-only', `section ${s}`);
  }
});

test('evaluateAccess: responsible party — questions R, conversation E, notes H, remediation R', () => {
  const cfg = makeConfig();
  const c = makeCase();
  assert.equal(evaluateAccess('questions', ['responsibleParty'], c, cfg), 'read-only');
  assert.equal(evaluateAccess('conversation', ['responsibleParty'], c, cfg), 'edit');
  assert.equal(evaluateAccess('notes', ['responsibleParty'], c, cfg), 'hidden');
  assert.equal(evaluateAccess('remediation', ['responsibleParty'], c, cfg), 'read-only');
});

test('evaluateAccess: RP outcome — hidden while in-progress, read-only when completed', () => {
  const cfg = makeConfig();
  assert.equal(
    evaluateAccess('outcome', ['responsibleParty'], makeCase({ status: 'In-progress' }), cfg),
    'hidden'
  );
  assert.equal(
    evaluateAccess('outcome', ['responsibleParty'], makeCase({ status: 'Completed' }), cfg),
    'read-only'
  );
});

test('evaluateAccess: case type owner read-only across the board', () => {
  const cfg = makeConfig();
  const c = makeCase();
  for (const s of SECTIONS) {
    assert.equal(evaluateAccess(s, ['caseTypeOwner'], c, cfg), 'read-only', `section ${s}`);
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
    evaluateAccess('conversation', ['otherReviewer', 'responsibleParty'], c, cfg),
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
  const realRoles = ['assignedReviewer', 'otherReviewer', 'responsibleParty', 'caseTypeOwner'];
  for (const role of realRoles) {
    assert.equal(
      evaluateAccess('details', [role], makeCase({ status: 'In-progress' }), cfg),
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

// --- Case Type opt-out ---

test('evaluateAccess: section omitted from sections allow-list → hidden regardless of role', () => {
  const cfg = makeConfig({ sections: ['questions', 'remediation', 'outcome'] });
  const c = makeCase();
  assert.equal(evaluateAccess('conversation', ['assignedReviewer'], c, cfg), 'hidden');
  assert.equal(evaluateAccess('notes', ['assignedReviewer'], c, cfg), 'hidden');
  assert.equal(evaluateAccess('questions', ['assignedReviewer'], c, cfg), 'edit');
});

test('evaluateAccess: sections undefined → defaults to all enabled', () => {
  const cfg = makeConfig();
  const c = makeCase();
  assert.equal(evaluateAccess('conversation', ['assignedReviewer'], c, cfg), 'edit');
});

test('evaluateAccess: empty sections array → all hidden', () => {
  const cfg = makeConfig({ sections: [] });
  const c = makeCase();
  for (const s of SECTIONS) {
    assert.equal(evaluateAccess(s, ['assignedReviewer'], c, cfg), 'hidden', `section ${s}`);
  }
});
