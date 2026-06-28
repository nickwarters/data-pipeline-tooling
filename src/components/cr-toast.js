// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import { toastMsg } from '../question-bank/question-bank-store.js';

// TODO(simplify-ui): Convert this class-backed custom element to the simpler
// function-component model. The target shape is a plain function returning h()
// nodes, wrapped in reactive() only when local signals need to re-render; keep
// custom elements only for route or browser-integration shells.
export class CRToast extends ReactiveElement {
  _render() {
    const content = this.render();
    if (Array.isArray(content)) {
      this.replaceChildren(...content);
    } else if (
      content &&
      typeof content === 'object' &&
      'appendChild' in content
    ) {
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
