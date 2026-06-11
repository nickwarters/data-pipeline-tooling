// @ts-check
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').Override} Override */
/** @typedef {import('../sharepoint-client.js').OutcomeResult} OutcomeResult */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/**
 * @typedef {{ questionText: string, originalValue: string, overriddenValue: string, source: 'qa' | 'appeal', reasoning: string }} OverrideRow
 */

/**
 * Compose the frozen original Answers with every Answer Override applied over
 * them (ADR-0018) — the Effective Answers, the input to the Current Outcome.
 *
 * Replace, never merge: an Override fully supplies the effective Answer for its
 * `answerKey` — its `value` plus whatever Remediation Actions / Attributed Party
 * / Remediation Details it carries. The frozen Answer's failure metadata never
 * bleeds through, so a fail→pass Override drops the original's actions and a
 * fail→still-fail Override swaps the action set wholesale. Overrides are applied
 * in array order; a later Override for the same `answerKey` wins.
 *
 * The original `answers` object is never mutated.
 *
 * @param {Record<string, Answer>} answers
 * @param {Override[]} [overrides]
 * @returns {Record<string, Answer>}
 */
export function effectiveAnswers(answers, overrides) {
  if (!overrides || overrides.length === 0) return answers;
  const result = { ...answers };
  for (const o of overrides) {
    /** @type {Answer} */
    const next = { value: o.value };
    if (o.remediationActions) next.remediationActions = o.remediationActions;
    if (o.attributedParty) next.attributedParty = o.attributedParty;
    if (o.remediationDetails) next.remediationDetails = o.remediationDetails;
    result[o.answerKey] = next;
  }
  return result;
}

/**
 * The **Current Outcome** (ADR-0018): the verdict derived by running the Case
 * Type's `computeOutcome` over the Effective Answers. Where no Override exists
 * the Effective Answers are the frozen original, so the result equals the
 * Case's `outcomeAtCompletion`; Overrides take precedence as they are applied.
 *
 * @param {(answers: Record<string, Answer>) => OutcomeResult} computeOutcome
 * @param {Record<string, Answer>} answers
 * @param {Override[]} [overrides]
 * @returns {OutcomeResult}
 */
export function currentOutcome(computeOutcome, answers, overrides) {
  return computeOutcome(effectiveAnswers(answers, overrides));
}

/**
 * Display value for an Answer/Override value: multi-choice arrays are joined,
 * a missing value renders as an em dash.
 *
 * @param {string | string[] | undefined} value
 * @returns {string}
 */
function formatValue(value) {
  if (value === undefined) return '—';
  return Array.isArray(value) ? value.join(', ') : value;
}

/**
 * Build the per-Answer original-vs-overridden rows for the read-only Summary
 * Outcome block (ADR-0018). One row per Override, matched to its Question by
 * `answerKey` for a human label (falling back to the raw key); the original
 * value comes from the frozen Answers. One row per Override in array order.
 *
 * @param {QuestionDefinition[]} catalogue
 * @param {Record<string, Answer>} answers
 * @param {Override[]} overrides
 * @returns {OverrideRow[]}
 */
export function buildOverrideRows(catalogue, answers, overrides) {
  return overrides.map(o => {
    const question = catalogue.find(q => q.id === o.answerKey);
    return {
      questionText: question ? question.text : o.answerKey,
      originalValue: formatValue(answers[o.answerKey]?.value),
      overriddenValue: formatValue(o.value),
      source: o.source,
      reasoning: o.reasoning,
    };
  });
}
