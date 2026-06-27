// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import { toastMsg } from '../question-bank/question-bank-store.js';

export class CRToast extends ReactiveElement {
  _render() {
    const content = this.render();
    if (Array.isArray(content)) {
      this.replaceChildren(...content);
    } else if (content && typeof content === 'object' && 'appendChild' in content) {
      this.replaceChildren(content);
    } else {
      this.replaceChildren();
    }
  }

  render() {
    const msg = toastMsg.get();
    return h(
      'div',
      { className: 'toast' + (msg ? ' show' : '') },
      h('span', { className: 'dot' }),
      h('span', {}, msg || '')
    );
  }
}

customElements.define('cr-toast', CRToast);
