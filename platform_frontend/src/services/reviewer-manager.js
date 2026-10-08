// @ts-check

/**
 * A person's current manager for a write that records it; an unusable answer is `null`, never inherited.
 *
 * Named for the Reviewer, whose assignment was its first caller; the Responsible
 * Party's manager is resolved the same way.
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
