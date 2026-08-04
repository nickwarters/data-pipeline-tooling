// @ts-check

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/**
 * Pairs the Assigned Reviewer's clock with the assignment itself: naming a
 * Reviewer stamps now, clearing the Reviewer clears the time, and a write that
 * says nothing about the Reviewer is returned untouched, so an ordinary Answers
 * save carries no assignment time at all.
 *
 * It is a shared module rather than a line inside one client because two client
 * implementations back the same interface, and a rule spelled twice is a rule
 * that eventually differs — after which the mock-first loop would show
 * something production does not store. The input is never mutated.
 *
 * @param {Partial<CaseRow>} fields
 * @param {() => Date} now
 * @returns {Partial<CaseRow>}
 */
export function withAssignmentStamp(fields, now) {
  if (fields.assignedReviewer === undefined) return fields;
  return {
    ...fields,
    assignedAt: fields.assignedReviewer ? now().toISOString() : null,
  };
}
