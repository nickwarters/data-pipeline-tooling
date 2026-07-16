// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import { activeSlug, commit, currentBank } from './question-bank-store.js';

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
                  'data-focus-key': `outcome:${bank.slug}:${option.id}:id`,
                  onchange: (/** @type {any} */ e) =>
                    props.renameOutcome(option, e.target.value),
                })
              ),
              outcomeField(
                'Wording',
                h('input', {
                  value: option.wording,
                  'data-focus-key': `outcome:${bank.slug}:${option.id}:wording`,
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

export class CORAOutcomeOptionsEditor extends ShellElement {
  render() {
    const bank = currentBank.get();
    return OutcomeOptionsEditor({
      bank,
      addOutcome: () =>
        commit((types) => {
          const b = types[activeSlug.get()];
          b.outcomeOptions ??= [];
          b.outcomeOptions.push(this._newOutcomeOption(b));
        }),
      setDefaultOutcome: (id) =>
        commit((types) => {
          const b = types[activeSlug.get()];
          if (id) b.defaultOutcomeId = id;
          else delete b.defaultOutcomeId;
        }),
      renameOutcome: (option, id) =>
        commit(() => {
          const previousId = option.id;
          const nextId = id.trim() || previousId;
          option.id = nextId;
          if (nextId !== previousId) {
            this._renameOutcomeReferences(bank, previousId, nextId);
          }
        }),
      setWording: (option, wording) =>
        commit(() => {
          option.wording = wording;
        }),
      setSeverity: (option, severity) =>
        commit(() => {
          // Severity is required (it is the outcome sort key), so a blank/invalid
          // entry coerces to 0 rather than clearing the field.
          const parsed = Number(severity);
          option.severity = Number.isFinite(parsed) ? parsed : 0;
        }),
      removeOutcome: (option, index) =>
        commit((types) => {
          const b = types[activeSlug.get()];
          this._clearOutcomeReferences(b, option.id);
          b.outcomeOptions?.splice(index, 1);
        }),
    });
  }

  /**
   * @param {import('./question-bank-source.js').QuestionBank} bank
   * @returns {import('../../sharepoint-client.js').OutcomeOption}
   */
  _newOutcomeOption(bank) {
    const existing = new Set((bank.outcomeOptions ?? []).map((o) => o.id));
    let index = (bank.outcomeOptions ?? []).length + 1;
    let id = `outcome-${index}`;
    while (existing.has(id)) {
      index += 1;
      id = `outcome-${index}`;
    }
    return {
      id,
      wording: 'New outcome',
      severity: 100,
    };
  }

  /**
   * @param {import('./question-bank-source.js').QuestionBank} bank
   * @param {string} previousId
   * @param {string} nextId
   */
  _renameOutcomeReferences(bank, previousId, nextId) {
    for (const question of bank.questions) {
      const map = question.optionOutcomes;
      if (!map) continue;
      for (const key of Object.keys(map)) {
        if (map[key] === previousId) map[key] = nextId;
      }
    }
    if (bank.defaultOutcomeId === previousId) bank.defaultOutcomeId = nextId;
  }

  /**
   * @param {import('./question-bank-source.js').QuestionBank} bank
   * @param {string} outcomeId
   */
  _clearOutcomeReferences(bank, outcomeId) {
    for (const question of bank.questions) {
      const map = question.optionOutcomes;
      if (!map) continue;
      for (const key of Object.keys(map)) {
        if (map[key] === outcomeId) delete map[key];
      }
      if (!Object.keys(map).length) delete question.optionOutcomes;
    }
    if (bank.defaultOutcomeId === outcomeId) delete bank.defaultOutcomeId;
  }

  /**
   * @param {string} label
   * @param {HTMLElement} control
   */
  _field(label, control) {
    return outcomeField(label, control);
  }

  /**
   * @param {string} value
   * @param {import('../../sharepoint-client.js').OutcomeOption[]} outcomeOptions
   * @param {(id: string) => void} onChange
   */
  _outcomeSelect(value, outcomeOptions, onChange) {
    return outcomeOptionsSelect(value, outcomeOptions, onChange);
  }
}

/**
 * @param {string} label
 * @param {HTMLElement} control
 */
export function outcomeField(label, control) {
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
export function outcomeOptionsSelect(value, outcomeOptions, onChange) {
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

customElements.define('cora-outcome-options-editor', CORAOutcomeOptionsEditor);
