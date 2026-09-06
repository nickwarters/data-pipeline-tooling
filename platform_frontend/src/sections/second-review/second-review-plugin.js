// src/sections/second-review/second-review-plugin.js
// @ts-check

/**
 * A Section the library never names.
 *
 * It exists to prove the composition path end to end: this module is reached
 * only because `src/app-config.js` imports it and lists it, its id is in the
 * `Section` union every Case Type's `sections` map is keyed by, and the Section
 * engine in `sections/registry.js` gained not one line for it.
 *
 * `evaluateAccess` and `view` are stubs on purpose, and the Section is
 * therefore invisible to everyone. What a Second Review *is* needs a decision
 * this ticket does not make: the domain language shelves the term, and a second
 * set of Answers is new data on the platform, which has to be considered for
 * the data pipelines and the answer recorded either way. Until both are
 * settled, `hidden` is the honest answer rather than a placeholder panel.
 *
 * `tabOrder` is fractional so it slots between Questions and Issues without
 * renumbering either — the property that makes the order a Section's own fact
 * rather than a position in a list.
 *
 * @satisfies {import('../contract.js').SectionPlugin}
 */
export const SecondReviewPlugin = /** @type {const} */ ({
  id: 'secondReview',
  tab: true,
  tabOrder: 2.5,
  summaryBlock: false,
  summaryOrder: 0,
  showInSummaryDefault: false,
  defaultLabels: { tab: 'Second Review', heading: 'Second Review' },

  evaluateAccess() {
    return 'hidden';
  },

  view() {
    return null;
  },
});
