// @ts-check
import { h } from '../../lib/html.js';
import {
  canMoveQuestion,
  canMoveQuestionWithinGroup,
} from '../../lib/question-order.js';
import { WordingEditor } from './wording-editor.js';
import { MAX_OPTION_LENGTH, OptionsEditor } from './options-editor.js';
import { QuestionLabels } from './question-labels.js';
import { ShowwhenEditor } from './showwhen-editor.js';
import { RemediationActionsEditor } from './cora-remediation-actions-editor.js';

/**
 * Pure Question Definition editing card.
 * @param {{ question: any, questionIndex: number, bank: any, baselineQuestions: any[], groupFilterActive: boolean, conditional: boolean, dispatch: (action: any) => void }} props
 */
export function QuestionCard(props) {
  const question = props.question;
  if (!question) return undefined;
  const questions = props.bank.questions;
  const directionAllowed = (/** @type {-1|1} */ direction) =>
    props.groupFilterActive
      ? canMoveQuestionWithinGroup(questions, question, direction)
      : canMoveQuestion(questions, question, direction);
  const field = (/** @type {string} */ name, /** @type {string} */ value) =>
    props.dispatch({
      type: 'question/field-changed',
      questionId: question.id,
      field: name,
      value,
    });
  const baselineQuestion = props.baselineQuestions.find(
    (candidate) => candidate.id === question.id
  );

  return h(
    'article',
    {
      key: question.id,
      className: 'card' + (question.deprecated ? ' deprecated' : ''),
    },
    h('div', {
      className: 'card-stripe',
      'data-testid': 'conditional-indicator',
      'aria-hidden': 'true',
      style:
        question.showWhen && !question.deprecated
          ? 'background: var(--ochre);'
          : '',
    }),
    h(
      'div',
      { className: 'card-head' },
      h(
        'div',
        { className: 'card-num' },
        h(
          'div',
          { className: 'card-num-label' },
          `№ ${String(props.questionIndex + 1).padStart(2, '0')}`
        ),
        h('input', {
          className: 'id-input',
          'aria-label': 'Question ID',
          value: question.id,
          onchange: (/** @type {any} */ event) =>
            field('id', event.target.value),
        })
      ),
      h(
        'div',
        { className: 'card-body' },
        /** @type {HTMLElement} */ (
          WordingEditor({
            question,
            baselineQuestion,
            onTextInput: (value) => field('text', value),
          })
        ),
        h(
          'div',
          { className: 'field-grid' },
          questionCardField(
            'Category',
            questionCardText(question.category ?? '', (value) =>
              field('category', value)
            )
          ),
          questionCardField(
            'Question Group',
            questionCardText(question.questionGroup ?? '', (value) =>
              field('questionGroup', value)
            )
          ),
          questionCardField(
            'Response Type',
            questionCardSelect(
              ['yes-no-na', 'single-choice', 'multi-choice', 'outcome'],
              question.responseType,
              (value) => field('responseType', value)
            )
          )
        ),
        /** @type {HTMLElement} */ (
          OptionsEditor({
            question,
            outcomeOptions: props.bank.outcomeOptions ?? [],
            onRemoveOption: (index, option) =>
              props.dispatch({
                type: 'question/option-removed',
                questionId: question.id,
                index,
                option,
              }),
            onAddOption: () => addOption(question.id, props.dispatch),
            onSetOptionOutcome: (option, outcomeId) =>
              props.dispatch({
                type: 'question/option-outcome-changed',
                questionId: question.id,
                option,
                outcomeId,
              }),
          })
        ),
        /** @type {HTMLElement} */ (
          QuestionLabels({
            question,
            bank: props.bank,
            dispatch: props.dispatch,
          })
        ),
        /** @type {HTMLElement} */ (
          ShowwhenEditor({
            question,
            conditional: props.conditional,
            bankQuestions: questions,
            dispatch: props.dispatch,
          })
        ),
        /** @type {HTMLElement} */ (
          RemediationActionsEditor({
            question,
            dispatch: props.dispatch,
          })
        )
      ),
      h(
        'div',
        { className: 'card-actions' },
        moveButton('up', -1, directionAllowed(-1), question, props),
        moveButton('down', 1, directionAllowed(1), question, props),
        h(
          'button',
          {
            className: 'icon-btn',
            title: question.deprecated ? 'Restore' : 'Mark deprecated',
            'aria-label': question.deprecated
              ? 'Restore question'
              : 'Mark deprecated',
            onclick: () =>
              props.dispatch({
                type: 'question/deprecation-toggled',
                questionId: question.id,
              }),
          },
          question.deprecated ? '↩' : '⌀'
        ),
        h(
          'button',
          {
            className: 'icon-btn',
            title: 'Duplicate',
            'aria-label': 'Duplicate question',
            onclick: () =>
              props.dispatch({
                type: 'question/duplicated',
                questionId: question.id,
              }),
          },
          '⎘'
        )
      )
    )
  );
}

/** @param {string} directionName @param {-1|1} direction @param {boolean} enabled @param {any} question @param {any} props */
function moveButton(directionName, direction, enabled, question, props) {
  return h(
    'button',
    {
      className: 'icon-btn',
      title: `Move question ${directionName}`,
      'aria-label': `Move question ${directionName}`,
      disabled: !enabled,
      onclick: () =>
        props.dispatch({
          type: 'question/moved',
          questionId: question.id,
          direction,
          withinGroup: props.groupFilterActive,
        }),
    },
    direction < 0 ? '↑' : '↓'
  );
}

/** @param {string} questionId @param {(action: any) => void} dispatch */
function addOption(questionId, dispatch) {
  const value = /** @type {any} */ (globalThis).prompt?.(
    `New option label (max ${MAX_OPTION_LENGTH} characters):`
  );
  const option = String(value ?? '').trim();
  if (!option) return;
  if (option.length > MAX_OPTION_LENGTH) {
    /** @type {any} */ (globalThis).alert?.(
      `Option label is too long: it must be ${MAX_OPTION_LENGTH} characters or fewer.`
    );
    return;
  }
  dispatch({ type: 'question/option-added', questionId, option });
}

/** @param {string} label @param {HTMLElement} control */
export function questionCardField(label, control) {
  if (!control.getAttribute?.('aria-label'))
    control.setAttribute?.('aria-label', label);
  return h('div', { className: 'field' }, h('label', {}, label), control);
}

/** @param {string} value @param {(value: string) => void} onChange */
export function questionCardText(value, onChange) {
  return h('input', {
    className: 'field-input',
    value,
    onchange: (/** @type {any} */ event) => onChange(event.target.value),
  });
}

/** @param {string[]} options @param {string} value @param {(value: string) => void} onChange */
export function questionCardSelect(options, value, onChange) {
  return h(
    'select',
    {
      className: 'field-select',
      onchange: (/** @type {any} */ event) => onChange(event.target.value),
    },
    ...options.map((option) =>
      h('option', { value: option, selected: option === value }, option)
    )
  );
}
