// @ts-check
import { CRElement } from './cr-element.js';
import { el, reactive } from './cr-bank-dom.js';
import { currentBank, diffCounts, drawerOpen } from './question-bank-store.js';

export class CRBankDock extends CRElement {
  connectedCallback() { reactive(this, () => this._render()); }
  _render() {
    const bank = currentBank.get();
    const all = bank.questions;
    const active = all.filter((/** @type {any} */ q) => !q.deprecated).length;
    const dep = all.filter((/** @type {any} */ q) => q.deprecated).length;
    const cond = all.filter((/** @type {any} */ q) => q.showWhen).length;
    const d = diffCounts.get();
    const total = d.added + d.changed + d.deprecated;
    const pendingTxt = total === 0 ? '0 changes' : `${total} change${total > 1 ? 's' : ''}`;

    this.replaceChildren(el('div', { class: 'dock' },
      el('div', { class: 'dock-status' },
        el('div', { class: 'dock-stat', html: `<span class="label">Active</span><strong>${active}</strong>` }),
        el('div', { class: 'dock-stat', html: `<span class="label">Deprecated</span><strong>${dep}</strong>` }),
        el('div', { class: 'dock-stat', html: `<span class="label">Conditional</span><strong>${cond}</strong>` }),
        el('div', { class: 'dock-stat', html: `<span class="label">Pending</span><strong>${pendingTxt}</strong>` }),
      ),
      el('div', { class: 'dock-actions' },
        el('button', { class: 'dock-btn', onclick: () => drawerOpen.set(true) }, 'Preview Config'),
        el('button', { class: 'dock-btn primary', onclick: () => drawerOpen.set(true) }, 'Submit for Review →'),
      ),
    ));
  }
}

customElements.define('cr-bank-dock', CRBankDock);
