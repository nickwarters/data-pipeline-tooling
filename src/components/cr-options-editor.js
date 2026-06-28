// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import { commit } from '../question-bank/question-bank-store.js';

// TODO(simplify-ui): Convert this class-backed custom element to the simpler
// function-component model. The target shape is a plain function returning h()
// nodes, wrapped in reactive() only when local signals need to re-render; keep
// custom elements only for route or browser-integration shells.
export class CROptionsEditor extends ReactiveElement {
  constructor() {
    super();
    /** @type {any} */
    this.question = null;
  }

  _render() {
    const content = this.render();
    if (content !== undefined) {
      if (Array.isArray(content)) {
        this.replaceChildren(...content);
      } else {
        this.replaceChildren(content);
      }
    } else {
      this.replaceChildren();
    }
  }

  render() {
    const q = this.question;
    if (!q) return undefined;

    return h(
      'div',
      { style: 'margin-top:14px;' },
      h('label', { class: 'options-label' }, 'Options'),
      h(
        'div',
        { class: 'tag-row' },
        ...(q.options || []).map(
          (/** @type {string} */ o, /** @type {number} */ idx) =>
            h(
              'span',
              { class: 'tag' },
              h('span', {}, o),
              h(
                'span',
                {
                  class: 'tag-x',
                  onclick: () => commit(() => q.options.splice(idx, 1)),
                },
                '×'
              )
            )
        ),
        h(
          'button',
          {
            class: 'tag-add',
            onclick: () => {
              const v = /** @type {any} */ (globalThis).prompt?.(
                'New option label:'
              );
              if (v && v.trim())
                commit(() => {
                  (q.options ||= []).push(v.trim());
                });
            },
          },
          '+ option'
        )
      )
    );
  }
}

customElements.define('cr-options-editor', CROptionsEditor);
