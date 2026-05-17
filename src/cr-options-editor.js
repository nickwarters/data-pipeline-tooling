// @ts-check
import { CRElement } from './cr-element.js';
import { el, reactive } from './cr-bank-dom.js';
import { commit } from './question-bank-store.js';

export class CROptionsEditor extends CRElement {
  constructor() {
    super();
    /** @type {any} */
    this.question = null;
  }
  connectedCallback() { reactive(this, () => this._render()); }
  _render() {
    const q = this.question;
    if (!q) return;
    const wrap = el('div', { style: 'margin-top:14px;' });
    wrap.appendChild(el('label', { class: 'options-label' }, 'Options'));
    const row = el('div', { class: 'tag-row' });
    (q.options || []).forEach((/** @type {string} */ o, /** @type {number} */ idx) => {
      row.appendChild(el('span', { class: 'tag' },
        el('span', {}, o),
        el('span', { class: 'tag-x',
          onclick: () => commit(() => q.options.splice(idx, 1)) }, '×'),
      ));
    });
    row.appendChild(el('button', { class: 'tag-add',
      onclick: () => {
        const v = (/** @type {any} */ (globalThis)).prompt?.('New option label:');
        if (v && v.trim()) commit(() => { (q.options ||= []).push(v.trim()); });
      } }, '+ option'));
    wrap.appendChild(row);
    this.replaceChildren(wrap);
  }
}

customElements.define('cr-options-editor', CROptionsEditor);
