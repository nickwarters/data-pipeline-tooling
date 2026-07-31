// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCase,
  caps,
  resolveRoles,
  ROLES,
} from './helpers/section-access.js';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import { WEB_URL, makeFetch } from './helpers/http-sharepoint-client.js';

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

test('resolveRoles: the Responsible Party a real read produces is one this matcher recognises', () => {
  // Both halves of the match come from SharePoint by different routes: the Case
  // Row through a list read, the viewer through `/_api/web/currentUser`. The
  // Role only ever resolves if those two routes yield the same kind of value —
  // and a Person column answers with a numeric site-local id unless the read
  // expands it, which no amount of testing either side alone would catch.
  const claims = 'i:0#.w|CONTOSO\\jrp';
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/web/currentUser'),
      respond: () =>
        new Response(
          JSON.stringify({ LoginName: claims, Title: 'Jordan RP' }),
          { status: 200 }
        ),
    },
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 'case-1',
            Title: 'T',
            Status: 'In-progress',
            CaseType: 'example-review',
            ResponsibleParty: { Name: claims, Title: 'Jordan RP' },
            Answers: '{}',
            Conversation: '[]',
            Notes: '',
            CompletedAt: null,
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  return Promise.all([
    client.getCase('case-1', { listName: 'Cases-ExampleReview' }),
    client.getCurrentUser(),
  ]).then(([row, user]) => {
    assert.ok(row);
    assert.deepEqual(resolveRoles(row, user.id, caps({ isAdviser: true })), [
      'responsibleParty',
    ]);
  });
});

test('resolveRoles: case type owner', () => {
  const roles = resolveRoles(
    makeCase(),
    'user-owner',
    caps({ ownedCaseTypes: ['example-review'] })
  );
  assert.deepEqual(roles, ['caseTypeOwner']);
});

test('resolveRoles: journey owner (from ownedJourneyCaseTypes)', () => {
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

// --- Reviewer Manager ---
// Scoped to the Case, exactly like the Responsible Party Manager: the role comes
// from the `assignedReviewerManager` row field, not from the platform-wide
// `Reviewer Managers` group. A manager reads the Cases of the Reviewers they
// manage, not every Case of every Case Type.

test('resolveRoles: the Reviewer Manager named on the Case row holds the role', () => {
  const roles = resolveRoles(
    makeCase({ assignedReviewerManager: 'user-rm' }),
    'user-rm',
    caps({ isReviewerManager: true })
  );
  assert.deepEqual(roles, ['reviewerManager']);
});

test('resolveRoles: a Reviewer Manager not named on the Case row holds no role', () => {
  const roles = resolveRoles(
    makeCase({ assignedReviewerManager: 'another-manager' }),
    'user-rm',
    caps({ isReviewerManager: true })
  );
  assert.deepEqual(roles, ['none']);
});

test('resolveRoles: group membership alone does not grant the role', () => {
  // A Case with no manager denormalised onto it grants nobody the role.
  const roles = resolveRoles(
    makeCase(),
    'user-rm',
    caps({ isReviewerManager: true })
  );
  assert.deepEqual(roles, ['none']);
});

test('resolveRoles: a reviewer manager who is also the assigned reviewer holds both roles', () => {
  const roles = resolveRoles(
    makeCase({ assignedReviewerManager: 'user-reviewer' }),
    'user-reviewer',
    caps({ isReviewer: true, isReviewerManager: true })
  );
  assert.deepEqual(roles.sort(), ['assignedReviewer', 'reviewerManager']);
});

// --- role vocabulary reachability ---

test('every role in the vocabulary is one resolveRoles can actually produce', () => {
  // The matrix contract test compares keys against this same list, so it agrees
  // with a dead name rather than catching it; only resolution tells them apart.
  //
  // Three viewings are the minimum: assignedReviewer and otherReviewer are
  // exclusive branches of the same check, and `none` only appears when nothing
  // else does.
  const everyRoleAtOnce = resolveRoles(
    makeCase({
      assignedReviewer: 'u1',
      assignedReviewerManager: 'u1',
      responsibleParty: 'u1',
      responsiblePartyManager: 'u1',
    }),
    'u1',
    caps({
      isControls: true,
      ownedCaseTypes: ['example-review'],
      ownedJourneyCaseTypes: ['example-review'],
    })
  );
  assert.deepEqual(everyRoleAtOnce.sort(), [
    'assignedReviewer',
    'caseTypeOwner',
    'controls',
    'journeyOwner',
    'responsibleParty',
    'responsiblePartyManager',
    'reviewerManager',
  ]);

  const unassignedReviewer = resolveRoles(
    makeCase({ assignedReviewer: 'someone-else' }),
    'u1',
    caps({ isReviewer: true })
  );

  const stranger = resolveRoles(makeCase({}), 'nobody', caps({}));

  const produced = new Set([
    ...everyRoleAtOnce,
    ...unassignedReviewer,
    ...stranger,
  ]);
  assert.deepEqual([...produced].sort(), [...ROLES].sort());
});
