// @ts-check
import { defineView } from '../lib/view.js';
import { h } from '../lib/html.js';
import { toastMsg } from '../question-bank/question-bank-store.js';

/**
 * Transient status toast. Reads the shared `toastMsg` signal, so it re-renders
 * whenever a `showToast()` call updates the message.
 *
 * @returns {HTMLElement}
 */
export function Toast() {
  const msg = toastMsg.get();
  return h(
    'div',
    { className: 'toast' + (msg ? ' show' : '') },
    h('span', { className: 'dot' }),
    h('span', {}, msg || '')
  );
}

export const CORAToast = defineView('cora-toast', {
  render() {
    return Toast();
  },
});
