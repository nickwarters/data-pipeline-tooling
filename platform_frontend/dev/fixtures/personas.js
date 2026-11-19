// @ts-check
/**
 * Persona definitions for mock mode.
 * Activate via the ?asUser= URL param, e.g. ?asUser=reviewer (default).
 * Available keys: reviewer, owner, journey-owner-complaints,
 * case-type-owner-complaints, admin,
 * responsible-party, responsible-party-manager, reviewer-manager,
 * controls (a standalone Controls user), maintainer (a standalone
 * Maintainer, the audience for Case Support),
 * action-centre (multi-role Reviewer+Controls+Owner, for seeing
 * every Action Centre reason group at once), visitor (no roles —
 * exercises the Visitor explainer-only branch).
 *
 * A persona's `roles` is their `CoraUserRoles` row, which is what the app
 * reads their roles from. Their `groups` only open Case lists, as in the
 * tenant, except `CORA Owner Delegates`, which still makes a Maintainer.
 *
 * @type {Record<string, import('../../src/services/mock-sharepoint-client.js').Persona>}
 */
export const personas = {
  reviewer: {
    userId: 'user-reviewer',
    displayName: 'Alex Reviewer',
    // Reviewing Complaints is what makes the complaints fixture Cases (all
    // assigned to user-reviewer) visible on this persona's dashboard.
    groups: ['Cases - Complaints Write'],
    roles: { reviews: ['complaints'] },
  },
  owner: {
    userId: 'user-owner',
    displayName: 'Sam Owner',
    groups: ['Cases - Example Review Write'],
    roles: { ownsCaseTypes: ['example-review'] },
  },
  'journey-owner-complaints': {
    userId: 'user-journey-owner-complaints',
    displayName: 'Jules Journey Owner Complaints',
    groups: ['Cases - Complaints Write'],
    roles: { journeyOwnerOf: ['complaints'] },
  },
  'case-type-owner-complaints': {
    userId: 'user-case-type-owner-complaints',
    displayName: 'Cam Case Type Owner Complaints',
    groups: ['Cases - Complaints Write'],
    roles: { ownsCaseTypes: ['complaints'] },
  },
  admin: {
    userId: 'user-admin',
    displayName: 'Riley Admin',
    groups: ['Cases - Example Review Write'],
    roles: { reviewer: true, ownsCaseTypes: ['example-review'] },
  },
  'responsible-party': {
    userId: 'user-rp',
    displayName: 'Jordan RP',
    groups: ['Cases - Complaints Write'],
    roles: { adviser: true },
  },
  'reviewer-manager': {
    userId: 'user-rm',
    displayName: 'Morgan Manager',
    groups: ['CORA All Cases Read'],
    roles: { reviewerManager: true },
  },
  // The line manager of `responsible-party`, named on complaints-case-5. The
  // Section role is resolved from that Case row field rather than the roles
  // row, so this persona only holds it on Cases that name them.
  'responsible-party-manager': {
    userId: 'user-rp-manager',
    displayName: 'Priya RP Manager',
    groups: ['CORA All Cases Read'],
    roles: { responsiblePartyManager: true },
  },
  controls: {
    userId: 'user-controls',
    displayName: 'Quinn Controls',
    groups: ['CORA All Cases Write'],
    roles: { controls: true },
  },
  maintainer: {
    userId: 'user-maintainer',
    displayName: 'Robin Maintainer',
    groups: ['CORA Owner Delegates'],
  },
  // Multi-role user (Reviewer + Controls + Owner) reusing user-reviewer's id so
  // the reviewer-scoped Action Centre groups pick up their assigned fixtures.
  // Shows the reason groups: Overdue, Awaiting Frontline, Appeals to work.
  'action-centre': {
    userId: 'user-reviewer',
    displayName: 'Dana Multi-role',
    groups: ['CORA All Cases Write'],
    roles: {
      reviewer: true,
      controls: true,
      ownsCaseTypes: ['example-review'],
    },
  },
  visitor: {
    userId: 'user-visitor',
    displayName: 'Casey Visitor',
    groups: [],
  },
};
