// @ts-check
import { evaluate } from './applicability-evaluator.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */

/**
 * @typedef {{ group: string, answered: number, total: number }} QuestionGroupProgress
 */

/**
 * Computes per-Question-Group answered/total counts for applicable,
 * non-deprecated questions. (This was `computeSectionProgress`, which
 * overloaded "section" — a reserved word for the role-gated tab areas — to
 * mean the question grouping; the grouping is now the Question Group.)
 * Questions without a Question Group are grouped under 'General'. Group order
 * follows first-seen order in the catalogue. An N/A Answer counts as answered.
 *
 * @param {QuestionDefinition[]} catalogue
 * @param {Record<string, Answer>} answers
 * @returns {QuestionGroupProgress[]}
 */
export function computeQuestionGroupProgress(catalogue, answers) {
  const active = catalogue.filter((q) => !q.deprecated);
  const applicableIds = evaluate(active, answers);

  /** @type {Map<string, QuestionGroupProgress>} */
  const map = new Map();

  for (const q of active) {
    if (!applicableIds.has(q.id)) continue;
    const group = q.questionGroup || 'General';
    if (!map.has(group)) map.set(group, { group, answered: 0, total: 0 });
    const entry = /** @type {QuestionGroupProgress} */ (map.get(group));
    entry.total += 1;
    const v = answers[q.id]?.value;
    const isAnswered = Array.isArray(v) ? v.length > 0 : !!v;
    if (isAnswered) entry.answered += 1;
  }

  return [...map.values()];
}
