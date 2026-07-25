// @ts-check
/**
 * What remediation an Answer carries — the two questions that can be answered
 * from the Answers blob alone, with no applicability graph and no failure rules.
 *
 * They live in this leaf module because `services/section-access.js` asks
 * `hasRemediation` on the dashboard boot path, and pulling the applicability and
 * failure evaluators in behind it would widen that module graph for a check that
 * needs neither (#499). `evaluators/remediation-status.js` re-exports both, so it
 * remains the one seam callers name.
 */

/** @typedef {import('../sharepoint-client.js').Answer} Answer */

/**
 * The remediation attached to one Answer, or `null` when it carries none.
 * Whitespace-only free-form text does not count as remediation.
 *
 * @param {Answer | undefined} answer
 * @returns {{ actions: Array<{ id: string, text: string }>, freeForm: string } | null}
 */
export function answerRemediation(answer) {
  const actions = (answer?.remediationActions ?? []).map((action) => ({
    id: action.id,
    text: action.text,
  }));
  const freeForm = (answer?.freeFormRemediation ?? '').trim();
  if (actions.length === 0 && freeForm === '') return null;
  return { actions, freeForm };
}

/**
 * Whether *any* Answer on the Case carries remediation. This is the visibility
 * gate for the Remediation Section: with nothing to track there is no tab.
 *
 * @param {Record<string, Answer>} answers
 * @returns {boolean}
 */
export function hasRemediation(answers) {
  return Object.values(answers ?? {}).some(
    (answer) => answerRemediation(answer) !== null
  );
}
