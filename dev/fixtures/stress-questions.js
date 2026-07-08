// @ts-check
/** @typedef {import('../../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/**
 * Generates a deterministic catalogue of N Question Definitions for stress
 * testing the framework. The catalogue mixes response types and includes
 * conditional questions that depend on prior answers, so the showWhen graph
 * is exercised at scale.
 *
 * Layout (cycle through):
 *   index % 5 === 0 → yes-no-na, no condition
 *   index % 5 === 1 → yes-no-na, conditional on the previous yes-no-na being 'Yes'
 *   index % 5 === 2 → single-choice (4 options)
 *   index % 5 === 3 → multi-choice (4 options)
 *   index % 5 === 4 → yes-no-na, conditional on q-stress-0 being 'Yes'
 *
 * Question id format: `q-stress-{n}` so tests can target specific items.
 *
 * @param {number} count
 * @returns {QuestionDefinition[]}
 */
export function generateStressQuestions(count) {
  /** @type {QuestionDefinition[]} */
  const out = [];
  for (let i = 0; i < count; i++) {
    const id = `q-stress-${i}`;
    const mod = i % 5;
    if (mod === 0) {
      out.push({
        id,
        text: `Stress question ${i}: yes-no-na anchor`,
        category: 'Stress',
        responseType: 'yes-no-na',
        optionOutcomes: { No: 'fail' },
        failureCriteria: 'No',
        deprecated: false,
      });
    } else if (mod === 1) {
      const prevAnchor = `q-stress-${i - 1}`;
      out.push({
        id,
        text: `Stress question ${i}: follow-up to ${prevAnchor}`,
        category: 'Stress',
        responseType: 'yes-no-na',
        optionOutcomes: { No: 'fail' },
        failureCriteria: 'No',
        showWhen: { [prevAnchor]: { equals: 'Yes' } },
        remediationActions: [`Document remediation for ${id}.`],
        deprecated: false,
      });
    } else if (mod === 2) {
      out.push({
        id,
        text: `Stress question ${i}: single-choice`,
        category: 'Stress',
        responseType: 'single-choice',
        options: ['Alpha', 'Bravo', 'Charlie', 'Delta'],
        deprecated: false,
      });
    } else if (mod === 3) {
      out.push({
        id,
        text: `Stress question ${i}: multi-choice`,
        category: 'Stress',
        responseType: 'multi-choice',
        options: ['Account', 'Billing', 'Support', 'Other'],
        deprecated: false,
      });
    } else {
      out.push({
        id,
        text: `Stress question ${i}: gated by q-stress-0`,
        category: 'Stress',
        responseType: 'yes-no-na',
        optionOutcomes: { No: 'fail' },
        failureCriteria: 'No',
        showWhen: { 'q-stress-0': { equals: 'Yes' } },
        deprecated: false,
      });
    }
  }
  return out;
}

/** Pre-generated 500-question catalogue for the dev harness. */
export const stressQuestions = generateStressQuestions(500);
