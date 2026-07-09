// @ts-check
import { evaluate } from './applicability-evaluator.js';
import { isFailure } from './failure-evaluator.js';
import {
  actionFieldKeys,
  coerceRemediationActions,
} from './remediation-actions.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').CaptureGroup} CaptureGroup */
/** @typedef {import('../sharepoint-client.js').RemediationAction} RemediationAction */

/**
 * @typedef {{ category: string, pass: number, fail: number }} CategoryCount
 * @typedef {{ id: string, category: string | undefined, text: string, answer: string, actions: string[], sentActions: RemediationAction[] }} SummaryFailure
 * @typedef {{ categoryCounts: CategoryCount[], remediationActionCount: number, failures: SummaryFailure[] }} SummaryModel
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
 * @param {CaptureGroup[]} [captureGroups] The Case Type's Issue Capture Groups,
 * used to read each failed Answer's *sent* Remediation Actions.
 * @returns {SummaryModel}
 */
export function buildSummaryModel(catalogue, answers, captureGroups = []) {
  const active = catalogue.filter((q) => !q.deprecated);
  const applicableIds = evaluate(active, answers);
  const applicable = active.filter((q) => applicableIds.has(q.id));

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
    if (!counts.has(category))
      counts.set(category, { category, pass: 0, fail: 0 });
    const entry = /** @type {CategoryCount} */ (counts.get(category));
    if (isFailure(q, answer)) entry.fail += 1;
    else entry.pass += 1;
  }

  const failedQuestions = applicable.filter((q) => isFailure(q, answers[q.id]));
  // The Summary reflects only what the Reviewer *selected* on each failed Answer
  // — the chosen canned actions plus any free-form entry — not the
  // question's full configured catalogue.
  const remediationActionCount = failedQuestions.reduce((total, q) => {
    const answer = answers[q.id];
    const selected = answer?.remediationActions?.length ?? 0;
    const free = answer?.freeFormRemediation ? 1 : 0;
    return total + selected + free;
  }, 0);

  const keys = actionFieldKeys(captureGroups);

  /** @type {SummaryFailure[]} */
  const failures = failedQuestions.map((q) => {
    // A failed question always has an Answer (isFailure is false without one).
    const answer = answers[q.id];
    const v = answer.value;
    /** @type {RemediationAction[]} */
    const sentActions = [];
    for (const key of keys) {
      const raw = answer.capture?.[key];
      if (Array.isArray(raw))
        sentActions.push(...coerceRemediationActions(raw, key));
    }
    // Selected canned actions, plus any free-form action, shown as
    // read-only text. Falls back to nothing when the Reviewer selected none.
    const actions = (answer.remediationActions ?? []).map(
      (action) => action.text
    );
    if (answer.freeFormRemediation) actions.push(answer.freeFormRemediation);
    return {
      id: q.id,
      category: q.category,
      text: q.text,
      answer: Array.isArray(v) ? v.join(', ') : v,
      actions,
      sentActions,
    };
  });

  return {
    categoryCounts: [...counts.values()],
    remediationActionCount,
    failures,
  };
}
