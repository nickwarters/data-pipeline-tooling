// @ts-check

/**
 * Persona definitions for mock mode.
 * Activate via ?asUser=reviewer (default), ?asUser=owner, or ?asUser=admin.
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
    groups: ['CaseTypeOwners-HelloReview'],
  },
  admin: {
    userId: 'user-admin',
    displayName: 'Riley Admin',
    groups: ['Reviewers', 'CaseTypeOwners-HelloReview'],
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
};
