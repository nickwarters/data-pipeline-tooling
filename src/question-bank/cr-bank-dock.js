// @ts-check
import { ReactiveElement } from '../components/reactive-element.js';
import { h } from '../lib/html.js';
import { currentBank, diffCounts, drawerOpen } from './question-bank-store.js';

export class CRBankDock extends ReactiveElement {
  render() {
    const bank = currentBank.get();
    const all = bank.questions;
    const active = all.filter((/** @type {any} */ q) => !q.deprecated).length;
    const dep = all.filter((/** @type {any} */ q) => q.deprecated).length;
    const cond = all.filter((/** @type {any} */ q) => q.showWhen).length;
    const d = diffCounts.get();
    const total = d.added + d.changed + d.deprecated;
    const pendingTxt =
      total === 0 ? '0 changes' : `${total} change${total > 1 ? 's' : ''}`;

    return h(
      'div',
      { className: 'dock' },
      h(
        'div',
        { className: 'dock-status' },
        stat('Active', String(active)),
        stat('Deprecated', String(dep)),
        stat('Conditional', String(cond)),
        stat('Pending', pendingTxt)
      ),
      h(
        'div',
        { className: 'dock-actions' },
        h(
          'button',
          { className: 'dock-btn', onClick: () => drawerOpen.set(true) },
          'Preview Config'
        ),
        h(
          'button',
          {
            className: 'dock-btn primary',
            onClick: () => drawerOpen.set(true),
          },
          'Submit for Review →'
        )
      )
    );
  }
}

customElements.define('cr-bank-dock', CRBankDock);

/**
 * @param {string} label
 * @param {string} value
 */
function stat(label, value) {
  return h(
    'div',
    { className: 'dock-stat' },
    h('span', { className: 'label' }, label),
    h('strong', {}, value)
  );
}
