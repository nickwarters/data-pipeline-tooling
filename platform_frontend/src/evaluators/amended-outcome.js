// @ts-check

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').AmendedOutcome} AmendedOutcome */

/**
 * The **Current Outcome**: the case-level Amended Outcome when Controls
 * has amended it, otherwise the frozen reviewer snapshot `outcomeAtCompletion`.
 * Where no amendment exists it equals the snapshot; where one exists it takes
 * precedence. Undefined before the reportable milestone (no snapshot stamped yet).
 *
 * @param {Pick<CaseRow, 'amendedOutcome' | 'outcomeAtCompletion'>} caseRow
 * @returns {string | undefined}
 */
export function currentOutcome(caseRow) {
  return caseRow.amendedOutcome?.outcome ?? caseRow.outcomeAtCompletion;
}

/**
 * Build the transactional field set for a case-level Outcome amendment.
 * The amendment is additive — the frozen `outcomeAtCompletion` is never touched —
 * and the **same ETag-guarded write** re-stamps the corrected-outcome reporting columns
 * from the hand-set verdict: `effectiveOutcome` carries the amended value and
 * `outcomeOverridden` flips true so the responsible-party-team report reads the
 * corrected result. `effectiveHadRemediation` carries the frozen `hadRemediation`:
 * an amendment changes only the Outcome verdict, not the remediation that actually
 * happened (Remediation Actions live on the frozen Answers, untouched here).
 *
 * @param {CaseRow} caseRow
 * @param {AmendedOutcome} amendment
 * @returns {Partial<CaseRow>}
 */
export function buildAmendmentFields(caseRow, amendment) {
  return {
    amendedOutcome: amendment,
    effectiveOutcome: amendment.outcome,
    effectiveHadRemediation: caseRow.hadRemediation ?? false,
    outcomeOverridden: true,
  };
}
