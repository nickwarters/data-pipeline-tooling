// @ts-check
import { ReactiveElement } from '../components/reactive-element.js';
import { h } from '../lib/html.js';
import { activeSlug, commit, currentBank } from './question-bank-store.js';

export class CROutcomeOptionsEditor extends ReactiveElement {
  render() {
    const bank = currentBank.get();
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
            onclick: () =>
              commit((types) => {
                const b = types[activeSlug.get()];
                b.outcomeOptions ??= [];
                b.outcomeOptions.push(this._newOutcomeOption(b));
              }),
          },
          '+ outcome'
        )
      ),
      h(
        'div',
        { className: 'default-outcome-row' },
        this._field(
          'Default outcome',
          this._outcomeSelect(bank.defaultOutcomeId ?? '', options, (id) =>
            commit((types) => {
              const b = types[activeSlug.get()];
              if (id) b.defaultOutcomeId = id;
              else delete b.defaultOutcomeId;
            })
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
                this._field(
                  'Id',
                  h('input', {
                    value: option.id,
                    'data-focus-key': `outcome:${bank.slug}:${option.id}:id`,
                    onchange: (/** @type {any} */ e) =>
                      commit(() => {
                        const previousId = option.id;
                        const nextId = e.target.value.trim() || previousId;
                        option.id = nextId;
                        if (nextId !== previousId) {
                          this._renameOutcomeReferences(
                            bank,
                            previousId,
                            nextId
                          );
                        }
                      }),
                  })
                ),
                this._field(
                  'Wording',
                  h('input', {
                    value: option.wording,
                    'data-focus-key': `outcome:${bank.slug}:${option.id}:wording`,
                    onchange: (/** @type {any} */ e) =>
                      commit(() => {
                        option.wording = e.target.value;
                      }),
                  })
                ),
                this._field(
                  'Severity',
                  h('input', {
                    type: 'number',
                    value: String(option.severity ?? index),
                    onchange: (/** @type {any} */ e) =>
                      commit(() => {
                        const parsed = Number(e.target.value);
                        if (Number.isFinite(parsed)) option.severity = parsed;
                        else delete option.severity;
                      }),
                  })
                ),
                h(
                  'button',
                  {
                    className: 'icon-btn danger',
                    title: 'Remove outcome option',
                    onclick: () =>
                      commit((types) => {
                        const b = types[activeSlug.get()];
                        this._clearOutcomeReferences(b, option.id);
                        b.outcomeOptions?.splice(index, 1);
                      }),
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
   * @param {import('../../dev/fixtures/question-banks.js').QuestionBank} bank
   * @returns {import('../sharepoint-client.js').OutcomeOption}
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
   * @param {import('../../dev/fixtures/question-banks.js').QuestionBank} bank
   * @param {string} previousId
   * @param {string} nextId
   */
  _renameOutcomeReferences(bank, previousId, nextId) {
    for (const question of bank.questions) {
      if (question.outcome?.noActionOutcomeId === previousId) {
        question.outcome.noActionOutcomeId = nextId;
      }
      for (const action of question.remediationActions ?? []) {
        if (typeof action !== 'string' && action.outcomeId === previousId) {
          action.outcomeId = nextId;
        }
      }
    }
    if (bank.defaultOutcomeId === previousId) bank.defaultOutcomeId = nextId;
  }

  /**
   * @param {import('../../dev/fixtures/question-banks.js').QuestionBank} bank
   * @param {string} outcomeId
   */
  _clearOutcomeReferences(bank, outcomeId) {
    for (const question of bank.questions) {
      if (question.outcome?.noActionOutcomeId === outcomeId) {
        delete question.outcome.noActionOutcomeId;
        if (!Object.keys(question.outcome).length) delete question.outcome;
      }
      for (const action of question.remediationActions ?? []) {
        if (typeof action !== 'string' && action.outcomeId === outcomeId) {
          delete action.outcomeId;
        }
      }
    }
    if (bank.defaultOutcomeId === outcomeId) delete bank.defaultOutcomeId;
  }

  /**
   * @param {string} label
   * @param {HTMLElement} control
   */
  _field(label, control) {
    return h(
      'label',
      { className: 'outcome-option-field' },
      h('span', {}, label),
      control
    );
  }

  /**
   * @param {string} value
   * @param {import('../sharepoint-client.js').OutcomeOption[]} outcomeOptions
   * @param {(id: string) => void} onChange
   */
  _outcomeSelect(value, outcomeOptions, onChange) {
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
}

customElements.define('cr-outcome-options-editor', CROutcomeOptionsEditor);
