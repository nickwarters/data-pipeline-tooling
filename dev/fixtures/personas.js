// @ts-check

/**
 * Persona definitions for mock mode.
 * Activate via ?asUser=reviewer (default) or ?asUser=owner.
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
    groups: ['Reviewers', 'CaseTypeOwners-HelloReview'],
  },
};
