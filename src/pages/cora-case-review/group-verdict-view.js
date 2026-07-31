// @ts-check
/**
 * The Group Verdict control — one selection that records the same Outcome
 * wording across a Question Group — and the two pure helpers that say what it
 * targets and what it displays. Nothing group-level is stored on the Case, so
 * both are derived from the Answers on every render.
 */

import { h } from '../../lib/html.js';

/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/**
 * The Question Group a Question Definition belongs to. Ungrouped Questions
 * collect under one visible heading rather than disappearing.
 *
 * @param {QuestionDefinition} question
 * @returns {string}
 */
export function questionGroupOf(question) {
  return question.questionGroup || 'General';
}

/**
 * The Questions one Group Verdict writes to: only an `outcome`-type Question
 * shares the Case Type's Outcome vocabulary, and a deprecated Question is one
 * no Reviewer is asked to answer any more. Applicability is not decided here —
 * the caller freezes it against the Answers as they stand before the write.
 *
 * @param {QuestionDefinition[]} questions
 * @param {string} questionGroup
 * @returns {QuestionDefinition[]}
 */
export function groupVerdictTargets(questions, questionGroup) {
  return questions.filter(
    (question) =>
      questionGroupOf(question) === questionGroup &&
      question.responseType === 'outcome' &&
      question.deprecated !== true
  );
}

/**
 * The wording the control displays: the one the group's **answered** Questions
 * agree on, or blank when they disagree or none is answered yet.
 *
 * Answered-only is the deliberate rule. A verdict can reveal a further Question
 * — that is the point of `showWhen` — and the verdict never fills a revealed
 * Question in, so counting unanswered Questions as disagreement would blank the
 * control at the very moment a verdict succeeded.
 *
 * @param {QuestionDefinition[]} targets
 * @param {Record<string, Answer>} answers
 * @returns {string}
 */
export function groupVerdictValue(targets, answers) {
  /** @type {string | null} */
  let shared = null;
  for (const target of targets) {
    const value = answers[target.id]?.value;
    if (typeof value !== 'string' || !value) continue;
    if (shared === null) shared = value;
    else if (shared !== value) return '';
  }
  return shared ?? '';
}

/**
 * @param {{
 *   questionGroup: string,
 *   options: string[],
 *   value: string,
 *   onGroupVerdict: (questionGroup: string, value: string) => void,
 * }} props
 */
export function GroupVerdictControl({
  questionGroup,
  options,
  value,
  onGroupVerdict,
}) {
  return h(
    'label',
    { className: 'cora-group-verdict-label' },
    h('span', {}, 'Group verdict'),
    h(
      'select',
      {
        className: 'cora-group-verdict',
        value,
        'aria-label': `Group verdict for ${questionGroup}`,
        onchange: (/** @type {Event} */ event) => {
          const chosen = /** @type {HTMLSelectElement} */ (event.target).value;
          // The placeholder is how the control shows "no shared verdict"; it is
          // not a wording, and clearing it writes nothing.
          if (!chosen) return;
          onGroupVerdict(questionGroup, chosen);
        },
      },
      h('option', { value: '' }, 'Set group verdict…'),
      ...options.map((option) => h('option', { value: option }, option))
    )
  );
}
