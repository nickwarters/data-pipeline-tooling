// @ts-check
import { evaluate } from './applicability-evaluator.js';
import { isFailure } from './failure-evaluator.js';
import { answerRemediation } from './answer-remediation.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */

/**
 * @typedef {{ category: string | undefined, group: string, pass: number, fail: number }} GroupCount
 * @typedef {{ id: string, category: string | undefined, questionGroup: string | undefined, text: string, answer: string, actions: string[] }} SummaryFailure
 * @typedef {{ groupCounts: GroupCount[], remediationActionCount: number, failures: SummaryFailure[] }} SummaryModel
 */

/**
 * Pure roll-up derivation for the read-only Summary Section. Computed
 * from whatever Answers are supplied — live while In-progress, the Case's frozen
 * Answers once Completed (editing is disabled, so the two coincide). Outcome is
 * derived separately by `cora-summary` because a Completed Case reads the frozen
 * `outcomeAtCompletion` snapshot rather than recomputing.
 *
 * @param {QuestionDefinition[]} catalogue
 * @param {Record<string, Answer>} answers
 * @returns {SummaryModel}
 */
export function buildSummaryModel(catalogue, answers) {
  const active = catalogue.filter((q) => !q.deprecated);
  const applicableIds = evaluate(active, answers);
  const applicable = active.filter((q) => applicableIds.has(q.id));

  /** @type {Map<string, GroupCount>} */
  const counts = new Map();
  for (const q of applicable) {
    // Only failure-scorable questions (those with derived failureValues, i.e.
    // at least one response mapping to a non-default Outcome) contribute
    // pass/fail counts; informational questions are excluded.
    if (!q.failureValues?.length) continue;
    const answer = answers[q.id];
    const v = answer?.value;
    const answered = Array.isArray(v) ? v.length > 0 : !!v;
    if (!answered) continue;
    // Counts are keyed by the *pair* of grouping levels, not the Question Group
    // alone: `category` is the level above, so the same group name declared
    // under two categories is two rows, exactly as the Review tab renders them.
    const category = q.category || undefined;
    const group = q.questionGroup || 'General';
    const key = `${category ?? ''}\u0000${group}`;
    if (!counts.has(key))
      counts.set(key, { category, group, pass: 0, fail: 0 });
    const entry = /** @type {GroupCount} */ (counts.get(key));
    if (isFailure(q, answer)) entry.fail += 1;
    else entry.pass += 1;
  }

  const failedQuestions = applicable.filter((q) => isFailure(q, answers[q.id]));

  // What a failed Answer carries has one definition — `answerRemediation`. In
  // particular it trims the free-form box, so a single typed space counts as a
  // Remediation Action here, on the Send Actions fork and on the Remediation
  // tab alike.
  const remediationOf = (/** @type {QuestionDefinition} */ q) =>
    answerRemediation(answers[q.id]);

  // The Summary reflects only what the Reviewer *selected* on each failed Answer
  // — the chosen canned actions plus any free-form entry — not the
  // question's full configured catalogue.
  const remediationActionCount = failedQuestions.reduce((total, q) => {
    const remediation = remediationOf(q);
    if (!remediation) return total;
    return total + remediation.actions.length + (remediation.freeForm ? 1 : 0);
  }, 0);

  /** @type {SummaryFailure[]} */
  const failures = failedQuestions.map((q) => {
    // A failed question always has an Answer (isFailure is false without one).
    const answer = answers[q.id];
    const v = answer.value;
    // Selected canned actions, plus any free-form action, shown as
    // read-only text. Falls back to nothing when the Reviewer selected none.
    const remediation = remediationOf(q);
    const actions = (remediation?.actions ?? []).map((action) => action.text);
    if (remediation?.freeForm) actions.push(remediation.freeForm);
    return {
      id: q.id,
      category: q.category || undefined,
      questionGroup: q.questionGroup,
      text: q.text,
      answer: Array.isArray(v) ? v.join(', ') : v,
      actions,
    };
  });

  return {
    groupCounts: [...counts.values()],
    remediationActionCount,
    failures,
  };
}
