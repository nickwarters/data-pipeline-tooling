// @ts-check
/**
 * Persona definitions for mock mode.
 * Activate via the ?asUser= URL param, e.g. ?asUser=reviewer (default).
 * Available keys: reviewer, owner, journey-owner-complaints,
 * case-type-owner-complaints, admin,
 * responsible-party, reviewer-manager, controls (a standalone Controls user,
 * ADR-0022), action-centre (multi-role Reviewer+Controls+Owner, for seeing
 * every Action Centre reason group at once — issue #287), visitor (no groups —
 * exercises the Visitor explainer-only branch).
 *
 * @type {Record<string, { userId: string, displayName: string, groups: string[] }>}
 */
export const personas = {
  reviewer: {
    userId: 'user-reviewer',
    displayName: 'Alex Reviewer',
    groups: ['Reviewers'],
  },
  owner: {
    userId: 'user-owner',
    displayName: 'Sam Owner',
    groups: ['CaseTypeOwner - Example Review'],
  },
  'journey-owner-complaints': {
    userId: 'user-journey-owner-complaints',
    displayName: 'Jules Journey Owner Complaints',
    groups: ['JourneyOwner - Complaints'],
  },
  'case-type-owner-complaints': {
    userId: 'user-case-type-owner-complaints',
    displayName: 'Cam Case Type Owner Complaints',
    groups: ['CaseTypeOwner - Complaints'],
  },
  admin: {
    userId: 'user-admin',
    displayName: 'Riley Admin',
    groups: ['Reviewers', 'CaseTypeOwner - Example Review'],
  },
  'responsible-party': {
    userId: 'user-rp',
    displayName: 'Jordan RP',
    groups: ['Advisers'],
  },
  'reviewer-manager': {
    userId: 'user-rm',
    displayName: 'Morgan Manager',
    groups: ['Reviewer-Managers'],
  },
  controls: {
    userId: 'user-controls',
    displayName: 'Quinn Controls',
    groups: ['Controls'],
  },
  // Multi-role user (Reviewer + Controls + Owner) reusing user-reviewer's id so
  // the reviewer-scoped Action Centre groups pick up their assigned fixtures.
  // Shows all five reason groups: Overdue, Awaiting Frontline, Review Required
  // (under "All"), Appeals to work, Reopened.
  'action-centre': {
    userId: 'user-reviewer',
    displayName: 'Dana Multi-role',
    groups: ['Reviewers', 'Controls', 'CaseTypeOwner - Example Review'],
  },
  visitor: {
    userId: 'user-visitor',
    displayName: 'Casey Visitor',
    groups: [],
  },
};
