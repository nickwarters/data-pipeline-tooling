// @ts-check
import { h } from '../../lib/html.js';
import {
  buildCaptureControl,
  applyCaptureFocusKey,
} from '../../lib/capture-engine.js';
import { generalAnswerKey } from '../../evaluators/general-questions.js';

/** @typedef {import('../../sharepoint-client.js').GeneralQuestionField} GeneralQuestionField */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../evaluators/general-questions.js').GeneralQuestionsPlacement} GeneralQuestionsPlacement */

/**
 * The section title rendered above the General Questions. Fixed rather than
 * configurable: a Case Type varies *which* General Questions it asks, not what
 * the section is called.
 */
export const GENERAL_QUESTIONS_TITLE = 'General Questions';

/**
 * The current value of a General Question, '' when unanswered.
 *
 * @param {Record<string, Answer>} answers
 * @param {string} fieldKey
 * @returns {string}
 */
function currentValue(answers, fieldKey) {
  const value = answers[generalAnswerKey(fieldKey)]?.value;
  return typeof value === 'string' ? value : '';
}

/**
 * Renders a Case Type's **General Questions**: arbitrary configured fields a
 * Reviewer answers alongside the Applicable Questions, shown above the first or
 * beneath the last Question Group, behind a separator. The caller places the
 * returned nodes; `placement` only decides which side of them the separator
 * falls on.
 *
 * General Questions are deliberately *not* outcome-driving. They carry no
 * `showWhen`, no failure mapping and no Remediation Actions, and their answers
 * are namespaced (`general:<key>`) inside the Case's `Answers` blob, so every
 * catalogue-driven evaluator — applicability, failure, Question Group progress,
 * completion gating and `computeOutcome` — steps straight over them.
 *
 * Field types are the Issue Capture Group vocabulary, rendered by the same
 * `buildCaptureControl`, so a Case Type Owner has one set of field types to
 * learn. Returns `[]` when the Case Type declares none.
 *
 * @param {{
 *   fields: GeneralQuestionField[],
 *   answers: Record<string, Answer>,
 *   access: 'edit'|'read-only'|'hidden',
 *   placement?: GeneralQuestionsPlacement,
 *   onAnswer: (answerKey: string, value: string) => void,
 * }} props
 * @returns {HTMLElement[]}
 */
export function GeneralQuestions({
  fields,
  answers,
  access,
  placement = 'after',
  onAnswer,
}) {
  if (!fields.length || access === 'hidden') return [];
  const canEdit = access === 'edit';

  const rule = h('hr', { className: 'cora-general-questions-rule' });
  const section = h(
    'section',
    { className: 'cora-general-questions' },
    h(
      'h3',
      { className: 'cora-general-questions-heading' },
      GENERAL_QUESTIONS_TITLE
    ),
    ...fields.map((field) => questionField(field, answers, canEdit, onAnswer))
  );
  // The separator always sits between the two sets of questions.
  return placement === 'before' ? [section, rule] : [rule, section];
}

/**
 * The Review tab's questions in configured order: the Applicable Questions with
 * the Case Type's General Questions placed before or after them. One place
 * decides the order, so the separator and the section can never disagree.
 *
 * @param {Node} applicableQuestions
 * @param {Parameters<typeof GeneralQuestions>[0]} props
 * @returns {Node[]}
 */
export function withGeneralQuestions(applicableQuestions, props) {
  const general = GeneralQuestions(props);
  return props.placement === 'before'
    ? [...general, applicableQuestions]
    : [applicableQuestions, ...general];
}

/**
 * @param {GeneralQuestionField} field
 * @param {Record<string, Answer>} answers
 * @param {boolean} canEdit
 * @param {(answerKey: string, value: string) => void} onAnswer
 * @returns {HTMLElement}
 */
function questionField(field, answers, canEdit, onAnswer) {
  const control = buildCaptureControl(
    field,
    currentValue(answers, field.key),
    (value) => {
      if (!canEdit) return;
      onAnswer(generalAnswerKey(field.key), value);
    },
    // The shared capture control classes, so a General Question looks like
    // every other typed field in the app rather than needing its own copy of
    // the input styling.
    'cora-capture-input',
    'general-'
  );
  // A stable focus key per control, so the Reviewer's caret survives an
  // autosave-driven re-render; disabled outside `edit` access.
  applyCaptureFocusKey(
    control,
    field,
    `general-question:${field.key}`,
    !canEdit
  );

  return h(
    'div',
    { className: 'cora-general-question' },
    h('label', { className: 'cora-capture-label' }, field.label),
    control
  );
}
