// @ts-check

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/**
 * The Assigned Reviewer's clock, paired with the assignment itself.
 *
 * The rule lives in the write path rather than at each call site because there
 * is more than one way a Case changes hands — self-allocation today, a
 * reassignment surface tomorrow — and a caller that sets the Reviewer without
 * stamping the time would leave the Assigned column reporting some other date
 * (it reported the Case's creation date for exactly that reason). Putting it
 * here means no caller can forget it, and the two clients cannot answer
 * differently.
 *
 * Three cases, in order:
 * - the write does not name a Reviewer: nothing to stamp, and the fields are
 *   handed back **by identity**, so an ordinary Answers save is provably
 *   untouched;
 * - the write already carries an `assignedAt`: an explicit value wins, which is
 *   what a backfill or a test needs;
 * - otherwise the column follows the Reviewer — a named Reviewer stamps now, and
 *   clearing the Reviewer clears the time, because an unassigned Case has no
 *   assignment moment and a stale one would make the column lie again.
 *
 * The input is never mutated.
 *
 * @param {Partial<CaseRow>} fields
 * @param {() => Date} now
 * @returns {Partial<CaseRow>}
 */
export function withAssignmentStamp(fields, now) {
  if (fields.assignedReviewer === undefined) return fields;
  if (fields.assignedAt !== undefined) return fields;
  return {
    ...fields,
    assignedAt: fields.assignedReviewer ? now().toISOString() : null,
  };
}
