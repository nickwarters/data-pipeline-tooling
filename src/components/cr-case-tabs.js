// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import {
  activeSlug,
  baseline,
  cases,
  drawerOpen,
  isDirty,
  setFilters,
  showToast,
} from '../question-bank/question-bank-store.js';
import { escapeHtml } from '../question-bank/question-bank-compile.js';

export class CRCaseTabs extends ReactiveElement {
  _render() {
    const content = this.render();
    if (content && typeof content === 'object' && 'appendChild' in content) {
      this.replaceChildren(content);
    } else if (Array.isArray(content)) {
      this.replaceChildren(...content);
    } else {
      this.replaceChildren();
    }
  }

  render() {
    const types = cases.get();
    const active = activeSlug.get();

    const tabs = h('div', { className: 'case-tabs' });
    for (const slug in types) {
      const t = types[slug];
      tabs.appendChild(
        h('button', {
          className: 'case-tab' + (slug === active ? ' active' : ''),
          onclick: () => {
            activeSlug.set(slug);
            setFilters({ category: null });
          },
          innerHTML: `${escapeHtml(t.label)}<span class="tab-count">${t.questions.length} q</span>`,
        })
      );
    }

    return h(
      'nav',
      { className: 'case-bar' },
      h('span', { className: 'case-bar-label' }, 'Case Type'),
      tabs,
      h(
        'div',
        { className: 'case-bar-right' },
        h(
          'button',
          {
            className: 'pill-btn',
            onclick: () => {
              if (!isDirty.get()) {
                showToast('Nothing to revert');
                return;
              }
              const ok = /** @type {any} */ (globalThis).confirm?.(
                'Discard all uncommitted edits and return to the last synced state?'
              );
              if (!ok) return;
              cases.set(structuredClone(baseline.get()));
              showToast('Reverted to baseline');
            },
          },
          '↺ Revert'
        ),
        h('button', {
          className: 'pill-btn primary',
          onclick: () => drawerOpen.set(true),
          innerHTML: 'Compile & Submit <span class="key">⌘↵</span>',
        })
      )
    );
  }
}

customElements.define('cr-case-tabs', CRCaseTabs);
