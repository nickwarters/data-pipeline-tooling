// @ts-check
import { h } from '../../lib/html.js';

/**
 * @param {{ bank: import('./question-bank-source.js').QuestionBank, addOutcome: () => void, setDefaultOutcome: (id: string) => void, renameOutcome: (option: import('../../sharepoint-client.js').OutcomeOption, id: string) => void, setWording: (option: import('../../sharepoint-client.js').OutcomeOption, wording: string) => void, setSeverity: (option: import('../../sharepoint-client.js').OutcomeOption, severity: string) => void, removeOutcome: (option: import('../../sharepoint-client.js').OutcomeOption, index: number) => void }} props
 * @returns {HTMLElement}
 */
export function OutcomeOptionsEditor(props) {
  const bank = props.bank;
  const options = bank.outcomeOptions ?? [];

  return h(
    'section',
    { className: 'outcome-options' },
    h(
      'div',
      { className: 'outcome-options-head' },
      h('h3', {}, 'Outcome options'),
      h(
        'button',
        {
          className: 'tag-add outcome-add',
          onclick: props.addOutcome,
        },
        '+ outcome'
      )
    ),
    h(
      'div',
      { className: 'default-outcome-row' },
      outcomeField(
        'Default outcome',
        outcomeOptionsSelect(bank.defaultOutcomeId ?? '', options, (id) =>
          props.setDefaultOutcome(id)
        )
      )
    ),
    options.length
      ? h(
          'div',
          { className: 'outcome-option-list' },
          options.map((option, index) =>
            h(
              'div',
              { className: 'outcome-option-row' },
              outcomeField(
                'Id',
                h('input', {
                  value: option.id,
                  onchange: (/** @type {any} */ e) =>
                    props.renameOutcome(option, e.target.value),
                })
              ),
              outcomeField(
                'Wording',
                h('input', {
                  value: option.wording,
                  onchange: (/** @type {any} */ e) =>
                    props.setWording(option, e.target.value),
                })
              ),
              outcomeField(
                'Severity',
                h('input', {
                  type: 'number',
                  value: String(option.severity ?? index),
                  onchange: (/** @type {any} */ e) =>
                    props.setSeverity(option, e.target.value),
                })
              ),
              h(
                'button',
                {
                  className: 'icon-btn danger',
                  title: 'Remove outcome option',
                  onclick: () => props.removeOutcome(option, index),
                },
                '×'
              )
            )
          )
        )
      : h(
          'div',
          { className: 'outcome-empty' },
          'No configured outcomes. Add at least one outcome to use dropdowns on questions.'
        )
  );
}

/**
 * @param {string} label
 * @param {HTMLElement} control
 */
function outcomeField(label, control) {
  return h(
    'label',
    { className: 'outcome-option-field' },
    h('span', {}, label),
    control
  );
}

/**
 * @param {string} value
 * @param {import('../../sharepoint-client.js').OutcomeOption[]} outcomeOptions
 * @param {(id: string) => void} onChange
 */
function outcomeOptionsSelect(value, outcomeOptions, onChange) {
  return h(
    'select',
    {
      value,
      disabled: outcomeOptions.length === 0,
      onchange: (/** @type {any} */ e) => onChange(e.target.value),
    },
    h(
      'option',
      { value: '' },
      outcomeOptions.length ? 'Built-in Pass' : 'No outcomes configured'
    ),
    ...outcomeOptions.map((option) =>
      h('option', { value: option.id }, option.wording)
    )
  );
}
