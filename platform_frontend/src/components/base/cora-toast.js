// @ts-check
import { h } from '../../lib/html.js';

/**
 * @param {{message: string}} state
 * @returns {HTMLElement}
 */
export function Toast({ message }) {
  return h(
    'div',
    { className: 'toast' + (message ? ' show' : '') },
    h('span', { className: 'dot' }),
    h('span', {}, message)
  );
}
