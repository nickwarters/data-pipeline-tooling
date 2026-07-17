// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCase, caps, resolveRoles } from './helpers/section-access.js';

// Capability: viewer role resolution.

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
