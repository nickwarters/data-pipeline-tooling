// @ts-check

/**
 * A Reviewer's current manager for an assignment write; an unusable answer is `null`, never inherited.
 *
 * @param {import('../sharepoint-client.js').SharePointClient} client
 * @param {string} reviewerId
 * @returns {Promise<string | null>}
 */
export async function resolveReviewerManager(client, reviewerId) {
  if (typeof client.resolveManagers !== 'function') return null;
  try {
    const managers = await client.resolveManagers([reviewerId]);
    const manager = managers?.[reviewerId];
    return typeof manager === 'string' && manager.trim() !== ''
      ? manager
      : null;
  } catch {
    return null;
  }
}
