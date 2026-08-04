// @ts-check
/**
 * The Group Outcome control — one selection that records the same Outcome
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
 * The Questions one Group Outcome writes to: only an `outcome`-type Question
 * shares the Case Type's Outcome vocabulary, and a deprecated Question is one
 * no Reviewer is asked to answer any more. Applicability is not decided here —
 * the caller freezes it against the Answers as they stand before the write.
 *
 * @param {QuestionDefinition[]} questions
 * @param {string} questionGroup
 * @returns {QuestionDefinition[]}
 */
export function groupOutcomeTargets(questions, questionGroup) {
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
 * Answered-only is the deliberate rule. Setting a group can reveal a further
 * Question — that is the point of `showWhen` — and a revealed Question is never
 * filled in, so counting unanswered Questions as disagreement would blank the
 * control at the very moment the Reviewer used it.
 *
 * @param {QuestionDefinition[]} targets
 * @param {Record<string, Answer>} answers
 * @returns {string}
 */
export function groupOutcomeValue(targets, answers) {
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
 *   onGroupOutcome: (questionGroup: string, value: string) => void,
 * }} props
 */
export function GroupOutcomeControl({
  questionGroup,
  options,
  value,
  onGroupOutcome,
}) {
  return h(
    'label',
    { className: 'cora-group-outcome-label' },
    h('span', {}, 'Group outcome'),
    h(
      'select',
      {
        className: 'cora-group-outcome',
        value,
        'aria-label': `Group outcome for ${questionGroup}`,
        onchange: (/** @type {Event} */ event) => {
          const chosen = /** @type {HTMLSelectElement} */ (event.target).value;
          // The placeholder is how the control shows "no shared wording"; it is
          // not a wording, and clearing it writes nothing.
          if (!chosen) return;
          onGroupOutcome(questionGroup, chosen);
        },
      },
      // Disabled so it can be displayed but not chosen: choosing it writes
      // nothing, so nothing would re-render, and the reconciler leaves a live
      // value alone while the authored one is unchanged — the control would sit
      // blank over a group that still holds the wording.
      h('option', { value: '', disabled: true }, 'Set group outcome…'),
      ...options.map((option) => h('option', { value: option }, option))
    )
  );
}
