// @ts-check
/**
 * @typedef {{
 *   manager: 'me' | null,
 *   role: 'reviewer-manager' | 'responsible-party-manager' | null,
 *   caseType: string | null,
 *   status: 'overdue' | 'outstanding' | 'completed' | null,
 *   completedSince: string | null,
 *   completedUntil: string | null,
 * }} TeamCasesParams
 */

/**
 * @param {string} search — the query string portion of the URL (e.g. "?manager=me&status=overdue")
 * @returns {TeamCasesParams}
 */
export function parseTeamCasesParams(search) {
  const p = new URLSearchParams(search);

  const managerRaw = p.get('manager');
  const roleRaw = p.get('role');
  const statusRaw = p.get('status');

  return {
    manager: managerRaw === 'me' ? 'me' : null,
    role:
      roleRaw === 'reviewer-manager'
        ? 'reviewer-manager'
        : roleRaw === 'responsible-party-manager'
          ? 'responsible-party-manager'
          : null,
    caseType: p.get('caseType'),
    status:
      statusRaw === 'overdue'
        ? 'overdue'
        : statusRaw === 'outstanding'
          ? 'outstanding'
          : statusRaw === 'completed'
            ? 'completed'
            : null,
    completedSince: p.get('completedSince'),
    completedUntil: p.get('completedUntil'),
  };
}
