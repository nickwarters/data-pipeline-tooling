// @ts-check
// TODO(simplify-ui): Keep dev fixtures as plain data inputs for the
// simplified UI. Future examples and tests should feed these fixtures into
// function components and pure helpers instead of custom-element lifecycle
// setup.

/**
 * Persona definitions for mock mode.
 * Activate via the ?asUser= URL param, e.g. ?asUser=reviewer (default).
 * Available keys: reviewer, owner, admin, responsible-party, reviewer-manager,
 * qa (a standalone QA Reviewer — opens QA Check Cases), visitor (no groups —
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
    groups: ['CaseTypeOwners-ExampleReview'],
  },
  admin: {
    userId: 'user-admin',
    displayName: 'Riley Admin',
    groups: ['Reviewers', 'CaseTypeOwners-ExampleReview'],
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
  qa: {
    userId: 'user-qa',
    displayName: 'Quinn QA',
    groups: ['QA-Reviewers'],
  },
  visitor: {
    userId: 'user-visitor',
    displayName: 'Casey Visitor',
    groups: [],
  },
};
