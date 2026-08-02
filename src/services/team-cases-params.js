// @ts-check
/**
 * @typedef {{ caseType: string | null }} TeamCasesParams
 */

/**
 * @param {string} search — the query string portion of the URL (e.g. "?caseType=complaints")
 * @returns {TeamCasesParams}
 */
export function parseTeamCasesParams(search) {
  return { caseType: new URLSearchParams(search).get('caseType') };
}
