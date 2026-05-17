// @ts-check
import { CRElement } from './cr-element.js';
import { el, reactive } from './cr-bank-dom.js';
import { toastMsg } from './question-bank-store.js';

export class CRToast extends CRElement {
  connectedCallback() { reactive(this, () => this._render()); }
  _render() {
    const msg = toastMsg.get();
    const t = el('div', { class: 'toast' + (msg ? ' show' : '') },
      el('span', { class: 'dot' }),
      el('span', {}, msg || ''),
    );
    this.replaceChildren(t);
  }
}

customElements.define('cr-toast', CRToast);
