// @ts-check
import { CRElement } from './cr-element.js';
import { el, reactive } from './cr-bank-dom.js';
import { activeSlug, baseline, cases, drawerOpen, isDirty, setFilters, showToast } from './question-bank-store.js';
import { escapeHtml } from './question-bank-compile.js';

export class CRCaseTabs extends CRElement {
  connectedCallback() { reactive(this, () => this._render()); }
  _render() {
    const types = cases.get();
    const active = activeSlug.get();
    const tabs = el('div', { class: 'case-tabs' });
    for (const slug in types) {
      const t = types[slug];
      tabs.appendChild(el('button', {
        class: 'case-tab' + (slug === active ? ' active' : ''),
        onclick: () => { activeSlug.set(slug); setFilters({ category: null }); },
        html: `${escapeHtml(t.label)}<span class="tab-count">${t.questions.length} q</span>`,
      }));
    }
    this.replaceChildren(el('nav', { class: 'case-bar' },
      el('span', { class: 'case-bar-label' }, 'Case Type'),
      tabs,
      el('div', { class: 'case-bar-right' },
        el('button', { class: 'pill-btn', onclick: () => {
          if (!isDirty.get()) { showToast('Nothing to revert'); return; }
          const ok = (/** @type {any} */ (globalThis)).confirm?.('Discard all uncommitted edits and return to the last synced state?');
          if (!ok) return;
          cases.set(structuredClone(baseline.get()));
          showToast('Reverted to baseline');
        } }, '↺ Revert'),
        el('button', { class: 'pill-btn primary', onclick: () => drawerOpen.set(true),
          html: 'Compile & Submit <span class="key">⌘↵</span>' }),
      ),
    ));
  }
}

customElements.define('cr-case-tabs', CRCaseTabs);
