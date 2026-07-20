// @ts-check
import { h } from '../../lib/html.js';

/**
 * @param {{ bank: any, diffCounts: { added: number, changed: number, deprecated: number }, openDrawer: () => void }} props
 * @returns {HTMLElement}
 */
export function BankDock(props) {
  const all = props.bank.questions;
  const active = all.filter((/** @type {any} */ q) => !q.deprecated).length;
  const dep = all.filter((/** @type {any} */ q) => q.deprecated).length;
  const cond = all.filter((/** @type {any} */ q) => q.showWhen).length;
  const d = props.diffCounts;
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
        { className: 'dock-btn', onClick: props.openDrawer },
        'Preview Config'
      ),
      h(
        'button',
        {
          className: 'dock-btn primary',
          onClick: props.openDrawer,
        },
        'Submit for Review →'
      )
    )
  );
}

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
