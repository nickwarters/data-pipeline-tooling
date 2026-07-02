// @ts-check
// TODO(simplify-ui): Keep dev fixtures as plain data inputs for the
// simplified UI. Future examples and tests should feed these fixtures into
// function components and pure helpers instead of custom-element lifecycle
// setup.

/**
 * Persona definitions for mock mode.
 * Activate via the ?asUser= URL param, e.g. ?asUser=reviewer (default).
 * Available keys: reviewer, owner, journey-owner-example-review,
 * journey-owner-complaints, case-type-owner-complaints, admin,
 * responsible-party, reviewer-manager, controls (a standalone Controls user,
 * ADR-0022), visitor (no groups — exercises the Visitor explainer-only branch).
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
  'journey-owner-example-review': {
    userId: 'user-journey-owner-example',
    displayName: 'Frankie Journey Owner Example Review',
    groups: ['JourneyOwner - Example Review'],
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
    groups: ['CR-ResponsibleParty'],
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
  visitor: {
    userId: 'user-visitor',
    displayName: 'Casey Visitor',
    groups: [],
  },
};
