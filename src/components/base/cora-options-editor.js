// @ts-check
import { h } from '../../lib/html.js';
import { commit } from '../../question-bank/question-bank-store.js';

/**
 * @typedef {Object} OptionsEditorProps
 * @property {any} question
 * @property {(index: number) => void} onRemoveOption
 * @property {() => void} onAddOption
 */

/**
 * @param {OptionsEditorProps} props
 * @returns {HTMLElement | undefined}
 */
export function OptionsEditor({ question, onRemoveOption, onAddOption }) {
  if (!question) return undefined;

  return h(
    'div',
    { style: 'margin-top:14px;' },
    h('label', { class: 'options-label' }, 'Options'),
    h(
      'div',
      { class: 'tag-row' },
      ...(question.options || []).map(
        (/** @type {string} */ option, /** @type {number} */ index) =>
          h(
            'span',
            { class: 'tag' },
            h('span', {}, option),
            h(
              'span',
              {
                class: 'tag-x',
                onclick: () => onRemoveOption(index),
              },
              '×'
            )
          )
      ),
      h(
        'button',
        {
          class: 'tag-add',
          onclick: onAddOption,
        },
        '+ option'
      )
    )
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
      onRemoveOption: (index) => {
        commit(() => this.question.options.splice(index, 1));
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
    });
  }
}

customElements.define('cora-options-editor', CORAOptionsEditor);
