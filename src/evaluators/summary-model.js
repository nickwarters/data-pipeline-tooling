// @ts-check
import { evaluate } from './applicability-evaluator.js';
import { isFailure } from './failure-evaluator.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */

/**
 * @typedef {{ category: string, pass: number, fail: number }} CategoryCount
 * @typedef {{ category: string | undefined, text: string, answer: string, actions: string[] }} SummaryFailure
 * @typedef {{ categoryCounts: CategoryCount[], remediationActionCount: number, failures: SummaryFailure[] }} SummaryModel
 */

/**
 * Pure roll-up derivation for the read-only Summary Section (ADR-0016). Computed
 * from whatever Answers are supplied — live while In-progress, the Case's frozen
 * Answers once Completed (editing is disabled, so the two coincide). Outcome is
 * derived separately by `cr-summary` because a Completed Case reads the frozen
 * `outcomeAtCompletion` snapshot rather than recomputing (ADR-0012).
 *
 * @param {QuestionDefinition[]} catalogue
 * @param {Record<string, Answer>} answers
 * @returns {SummaryModel}
 */
export function buildSummaryModel(catalogue, answers) {
  const active = catalogue.filter(q => !q.deprecated);
  const applicableIds = evaluate(active, answers);
  const applicable = active.filter(q => applicableIds.has(q.id));

  /** @type {Map<string, CategoryCount>} */
  const counts = new Map();
  for (const q of applicable) {
    // Only failure-scorable questions (those with a failureCriteria) contribute
    // pass/fail counts; informational questions are excluded.
    if (!q.failureCriteria) continue;
    const answer = answers[q.id];
    const v = answer?.value;
    const answered = Array.isArray(v) ? v.length > 0 : !!v;
    if (!answered) continue;
    const category = q.category || 'General';
    if (!counts.has(category)) counts.set(category, { category, pass: 0, fail: 0 });
    const entry = /** @type {CategoryCount} */ (counts.get(category));
    if (isFailure(q, answer)) entry.fail += 1;
    else entry.pass += 1;
  }

  const failedQuestions = applicable.filter(q => isFailure(q, answers[q.id]));
  const remediationActionCount = failedQuestions.reduce(
    (total, q) => total + (q.remediationActions?.length ?? 0),
    0
  );

  /** @type {SummaryFailure[]} */
  const failures = failedQuestions.map(q => {
    // A failed question always has an Answer (isFailure is false without one).
    const v = answers[q.id].value;
    return {
      category: q.category,
      text: q.text,
      answer: Array.isArray(v) ? v.join(', ') : v,
      actions: q.remediationActions ?? [],
    };
  });

  return {
    categoryCounts: [...counts.values()],
    remediationActionCount,
    failures,
  };
}
