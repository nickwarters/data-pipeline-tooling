// @ts-check
import { h } from '../../lib/html.js';
import { buildCaptureControl } from '../../lib/capture-engine.js';

/** @typedef {import('../../sharepoint-client.js').CaptureField} CaptureField */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */

/**
 * The section title rendered above the General Questions. Fixed rather than
 * configurable: a Case Type varies *which* General Questions it asks, not what
 * the section is called.
 */
export const GENERAL_QUESTIONS_TITLE = 'General Questions';

/**
 * The namespace every General Question answer key carries inside the Case's
 * `Answers` blob. A Question Definition id is a bank identifier and never
 * contains `:`, so a namespaced key cannot collide with one — which is what
 * keeps the two kinds of answer able to share one blob.
 */
export const GENERAL_ANSWER_PREFIX = 'general:';

/**
 * @param {string} fieldKey
 * @returns {string}
 */
export function generalAnswerKey(fieldKey) {
  return `${GENERAL_ANSWER_PREFIX}${fieldKey}`;
}

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
 * Reviewer answers alongside the Applicable Questions, shown beneath the last
 * Question Group behind a separator.
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
 *   fields: CaptureField[],
 *   answers: Record<string, Answer>,
 *   access: 'edit'|'read-only'|'hidden',
 *   onAnswer: (answerKey: string, value: string) => void,
 * }} props
 * @returns {HTMLElement[]}
 */
export function GeneralQuestions({ fields, answers, access, onAnswer }) {
  if (!fields.length || access === 'hidden') return [];
  const canEdit = access === 'edit';

  return [
    h('hr', { className: 'cora-general-questions-rule' }),
    h(
      'section',
      { className: 'cora-general-questions' },
      h(
        'h3',
        { className: 'cora-general-questions-heading' },
        GENERAL_QUESTIONS_TITLE
      ),
      ...fields.map((field) => questionField(field, answers, canEdit, onAnswer))
    ),
  ];
}

/**
 * @param {CaptureField} field
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
  applyAccess(control, field, canEdit);

  return h(
    'div',
    { className: 'cora-general-question' },
    h('label', { className: 'cora-capture-label' }, field.label),
    control
  );
}

/**
 * Tags the field's focusable control(s) with a stable `data-focus-key` so the
 * Reviewer's focus and caret survive an autosave-driven re-render, and disables
 * them outside `edit` access. A `radio` field is a wrapper around several
 * inputs, so both are applied per input.
 *
 * @param {HTMLElement} control
 * @param {CaptureField} field
 * @param {boolean} canEdit
 */
function applyAccess(control, field, canEdit) {
  const key = `general-question:${field.key}`;
  if (field.type === 'radio') {
    for (const input of control.querySelectorAll('input')) {
      input.setAttribute('data-focus-key', `${key}:${input.value}`);
      input.disabled = !canEdit;
    }
    return;
  }
  control.setAttribute('data-focus-key', key);
  /** @type {any} */ (control).disabled = !canEdit;
}
