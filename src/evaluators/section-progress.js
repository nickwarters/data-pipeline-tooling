// @ts-check
import { evaluate } from './applicability-evaluator.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */

/**
 * @typedef {{ section: string, answered: number, total: number }} SectionProgress
 */

/**
 * Computes per-section answered/total counts for applicable, non-deprecated questions.
 * Questions without a category are grouped under 'General'.
 * Section order follows first-seen category order in the catalogue.
 *
 * @param {QuestionDefinition[]} catalogue
 * @param {Record<string, Answer>} answers
 * @returns {SectionProgress[]}
 */
export function computeSectionProgress(catalogue, answers) {
  const active = catalogue.filter((q) => !q.deprecated);
  const applicableIds = evaluate(active, answers);

  /** @type {Map<string, SectionProgress>} */
  const map = new Map();

  for (const q of active) {
    if (!applicableIds.has(q.id)) continue;
    const section = q.category || 'General';
    if (!map.has(section)) map.set(section, { section, answered: 0, total: 0 });
    const entry = /** @type {SectionProgress} */ (map.get(section));
    entry.total += 1;
    const v = answers[q.id]?.value;
    const isAnswered = Array.isArray(v) ? v.length > 0 : !!v;
    if (isAnswered) entry.answered += 1;
  }

  return [...map.values()];
}
