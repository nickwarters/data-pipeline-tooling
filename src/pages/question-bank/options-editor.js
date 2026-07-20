// @ts-check
import { h } from '../../lib/html.js';
import { outcomeResponseOptions } from '../../evaluators/configured-outcome.js';
import { YES_NO } from '../../lib/response-options.js';

/**
 * Single-option answers render as radio cards on the case review page, so
 * they must stay to a sentence rather than growing into a paragraph.
 */
export const MAX_OPTION_LENGTH = 250;

/**
 * Resolves the effective response options for a question plus whether the option
 * list and its Outcome mapping are editable:
 * - `yes-no-na` → fixed `Yes`/`No`; outcome mapping editable.
 * - `outcome` → the Case Type's configured Outcomes (read-only), each mapped
 * to itself (read-only).
 * - single/multi → the question's own `options`; both list and mapping editable.
 *
 * The universal N/A never appears here: it is offered to the Reviewer on every
 * question but is not authorable and never maps to an Outcome (#390 Part 2).
 *
 * @param {any} question
 * @param {import('../../sharepoint-client.js').OutcomeOption[]} outcomeOptions
 * @returns {{ options: string[], editable: boolean, outcomeReadOnly: boolean, mapping: Record<string, string> }}
 */
export function effectiveOptions(question, outcomeOptions) {
  if (question.responseType === 'yes-no-na') {
    return {
      options: YES_NO,
      editable: false,
      outcomeReadOnly: false,
      mapping: question.optionOutcomes || {},
    };
  }
  if (question.responseType === 'outcome') {
    const derived = outcomeResponseOptions(outcomeOptions);
    return {
      options: derived.options,
      editable: false,
      outcomeReadOnly: true,
      mapping: derived.optionOutcomes,
    };
  }
  return {
    options: question.options ?? [],
    editable: true,
    outcomeReadOnly: false,
    mapping: question.optionOutcomes || {},
  };
}

/**
 * Per-option Outcome `<select>`: the response drives the Outcome, so every
 * response option can map to one of the Case Type's configured Outcomes. Disabled
 * (read-only) for `outcome`-type questions, whose mapping is fixed, and when no
 * Outcomes are configured.
 *
 * @param {string} value
 * @param {import('../../sharepoint-client.js').OutcomeOption[]} outcomeOptions
 * @param {boolean} disabled
 * @param {(id: string) => void} onChange
 */
export function optionOutcomeSelect(value, outcomeOptions, disabled, onChange) {
  return h(
    'select',
    {
      className: 'opt-outcome-select',
      value,
      disabled: disabled || outcomeOptions.length === 0,
      onchange: (/** @type {any} */ e) => onChange(e.target.value),
    },
    h(
      'option',
      { value: '' },
      outcomeOptions.length ? 'No outcome' : 'No outcomes configured'
    ),
    ...outcomeOptions.map((option) =>
      h('option', { value: option.id }, option.wording)
    )
  );
}

/**
 * @typedef {Object} OptionsEditorProps
 * @property {any} question
 * @property {import('../../sharepoint-client.js').OutcomeOption[]} outcomeOptions
 * @property {(index: number, option: string) => void} onRemoveOption
 * @property {() => void} onAddOption
 * @property {(option: string, outcomeId: string) => void} onSetOptionOutcome
 */

/**
 * @param {OptionsEditorProps} props
 * @returns {HTMLElement | undefined}
 */
export function OptionsEditor({
  question,
  outcomeOptions,
  onRemoveOption,
  onAddOption,
  onSetOptionOutcome,
}) {
  if (!question) return undefined;

  const { options, editable, outcomeReadOnly, mapping } = effectiveOptions(
    question,
    outcomeOptions
  );

  const rows = options.map((option, index) => {
    const children = [
      h('span', { class: 'opt-label' }, option),
      optionOutcomeSelect(
        mapping[option] ?? '',
        outcomeOptions,
        outcomeReadOnly,
        (id) => onSetOptionOutcome(option, id)
      ),
    ];
    if (editable) {
      children.push(
        h(
          'span',
          { class: 'tag-x', onclick: () => onRemoveOption(index, option) },
          '×'
        )
      );
    }
    return h('div', { class: 'opt-row' }, ...children);
  });

  const list = [...rows];
  if (editable) {
    list.push(
      h('button', { class: 'tag-add', onclick: onAddOption }, '+ option')
    );
  }

  return h(
    'div',
    { style: 'margin-top:14px;' },
    h('label', { class: 'options-label' }, 'Options'),
    h('div', { class: 'opt-list' }, ...list),
    h(
      'p',
      { class: 'opt-na-note' },
      'N/A is always offered to the Reviewer and never maps to an Outcome.'
    )
  );
}
