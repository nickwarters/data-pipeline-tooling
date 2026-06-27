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

export class CRCaseTabs extends ReactiveElement {
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
    const types = cases.get();
    const active = activeSlug.get();

    const tabs = h('div', { className: 'case-tabs' });
    for (const slug in types) {
      const t = types[slug];
      tabs.appendChild(
        h(
          'button',
          {
            className: 'case-tab' + (slug === active ? ' active' : ''),
            onclick: () => {
              activeSlug.set(slug);
              setFilters({ category: null });
            },
          },
          t.label,
          h('span', { className: 'tab-count' }, `${t.questions.length} q`)
        )
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
        h(
          'button',
          {
            className: 'pill-btn primary',
            onclick: () => drawerOpen.set(true),
          },
          'Compile & Submit ',
          h('span', { className: 'key' }, '⌘↵')
        )
      )
    );
  }
}

customElements.define('cr-case-tabs', CRCaseTabs);
