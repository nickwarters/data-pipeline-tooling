// @ts-check
import { h } from '../../lib/html.js';
import {
  commit,
  currentBank,
} from '../../question-bank/question-bank-store.js';
import { outcomeResponseOptions } from '../../evaluators/configured-outcome.js';

const YES_NO_NA = ['Yes', 'No', 'NA'];

/**
 * Resolves the effective response options for a question plus whether the option
 * list and its Outcome mapping are editable:
 * - `yes-no-na` → fixed `Yes`/`No`/`NA`; outcome mapping editable.
 * - `outcome` → the Case Type's configured Outcomes (read-only), each mapped
 * to itself (read-only).
 * - single/multi → the question's own `options`; both list and mapping editable.
 *
 * @param {any} question
 * @param {import('../../sharepoint-client.js').OutcomeOption[]} outcomeOptions
 * @returns {{ options: string[], editable: boolean, outcomeReadOnly: boolean, mapping: Record<string, string> }}
 */
export function effectiveOptions(question, outcomeOptions) {
  if (question.responseType === 'yes-no-na') {
    return {
      options: YES_NO_NA,
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
    h('div', { class: 'opt-list' }, ...list)
  );
}

export class CORAOptionsEditor extends HTMLElement {
  constructor() {
    super();
    /** @type {any} */
    this.question = null;
  }

  connectedCallback() {
    this._render();
  }

  _render() {
    const content = this.render();
    if (content) this.replaceChildren(content);
    else this.replaceChildren();
  }

  render() {
    return OptionsEditor({
      question: this.question,
      outcomeOptions: currentBank.get()?.outcomeOptions ?? [],
      onRemoveOption: (index, option) => {
        commit(() => {
          this.question.options.splice(index, 1);
          if (this.question.optionOutcomes) {
            delete this.question.optionOutcomes[option];
            if (!Object.keys(this.question.optionOutcomes).length)
              delete this.question.optionOutcomes;
          }
        });
      },
      onAddOption: () => {
        const value = /** @type {any} */ (globalThis).prompt?.(
          'New option label:'
        );
        if (value && value.trim()) {
          commit(() => {
            (this.question.options ||= []).push(value.trim());
          });
        }
      },
      onSetOptionOutcome: (option, outcomeId) => {
        commit(() => {
          if (outcomeId) {
            (this.question.optionOutcomes ||= {})[option] = outcomeId;
          } else if (this.question.optionOutcomes) {
            delete this.question.optionOutcomes[option];
            if (!Object.keys(this.question.optionOutcomes).length)
              delete this.question.optionOutcomes;
          }
        });
      },
    });
  }
}

customElements.define('cora-options-editor', CORAOptionsEditor);
