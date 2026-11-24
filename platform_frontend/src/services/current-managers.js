// @ts-check

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/**
 * Pairs each recorded manager with the current manager that decides access:
 * a write that records the Reviewer's or the Responsible Party's manager
 * writes the same person to the matching current field, and a write that
 * records neither is returned untouched.
 *
 * The two kinds of field answer different questions. The recorded managers say
 * who managed the person when they were set on the Case, and are never changed
 * afterwards. The current managers say who manages them now, and it is a
 * process outside this application that keeps them so after this first write:
 * nothing here updates them again. That is why the pairing happens only here,
 * at the moment the recorded field is written.
 *
 * A write that names a current manager itself is left as it is. Both clients
 * apply this, for the reason given beside `withAssignmentStamp`, after the
 * Responsible Party's manager has been resolved. The input is never mutated.
 *
 * @param {Partial<CaseRow>} fields
 * @returns {Partial<CaseRow>}
 */
export function withCurrentManagers(fields) {
  let out = fields;
  if (
    fields.assignedReviewerManager !== undefined &&
    fields.currentReviewerManager === undefined
  ) {
    out = { ...out, currentReviewerManager: fields.assignedReviewerManager };
  }
  if (
    fields.responsiblePartyManager !== undefined &&
    fields.currentResponsiblePartyManager === undefined
  ) {
    out = {
      ...out,
      currentResponsiblePartyManager: fields.responsiblePartyManager,
    };
  }
  return out;
}
