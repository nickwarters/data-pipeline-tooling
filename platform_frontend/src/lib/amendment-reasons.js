// @ts-check
/**
 * The shared vocabulary of Amendment Reasons: what prompted Controls to hand-set
 * a new Outcome on a Case that had already been reviewed to a verdict. A Case
 * Type may extend it, never re-key it. The keys are what is persisted; the
 * labels are display copy and may be reworded freely.
 */

/** @typedef {import('../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */

/**
 * One selectable reason for an Outcome amendment.
 *
 * @typedef {{ key: string, label: string }} AmendmentReason
 */

// Frozen through to the members, not just the list: these keys are the shared
// spine every Case Type's list starts from, so a caller that could reword or
// re-key one in place would change what every other Case Type offers.
/** @type {readonly AmendmentReason[]} */
export const AMENDMENT_REASONS = Object.freeze([
  Object.freeze({ key: 'qa-check', label: 'QA Check' }),
  Object.freeze({ key: 'tm-check', label: 'TM Check' }),
  Object.freeze({ key: 'appeal', label: 'Appeal' }),
]);

/**
 * The reasons a Case Type offers: the framework defaults first, then whatever
 * the Case Type adds, in the order it declares them. A key colliding with a
 * default keeps the default's label and position rather than appearing twice —
 * the shared spine wins, so no Case Type can quietly re-label a shared key.
 *
 * @param {Partial<CaseTypeConfig> | null | undefined} config
 * @returns {AmendmentReason[]}
 */
export function amendmentReasonsFor(config) {
  const reasons = [...AMENDMENT_REASONS];
  for (const extra of config?.extraAmendmentReasons ?? []) {
    if (reasons.some((reason) => reason.key === extra.key)) continue;
    reasons.push(extra);
  }
  return reasons;
}
