// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import {
  activeSlug,
  baseline,
  cases,
  drawerOpen,
  isDirty,
  setFilters,
  showToast,
} from '../../question-bank/question-bank-store.js';

/**
 * @typedef {Object} CaseTabsProps
 * @property {Record<string, { label: string, questions: unknown[] }>} types
 * @property {string} active
 * @property {boolean} dirty
 * @property {(slug: string) => void} onSelect
 * @property {() => void} onRevert
 * @property {() => void} onCompile
 */

/**
 * @param {CaseTabsProps} props
 * @returns {HTMLElement}
 */
export function CaseTabs({
  types,
  active,
  dirty: _dirty,
  onSelect,
  onRevert,
  onCompile,
}) {
  const tabs = h('div', { className: 'case-tabs' });
  for (const slug in types) {
    const type = types[slug];
    tabs.appendChild(
      h(
        'button',
        {
          className: 'case-tab' + (slug === active ? ' active' : ''),
          onclick: () => onSelect(slug),
        },
        type.label,
        h('span', { className: 'tab-count' }, `${type.questions.length} q`)
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
          onclick: onRevert,
        },
        '↺ Revert'
      ),
      h(
        'button',
        {
          className: 'pill-btn primary',
          onclick: onCompile,
        },
        'Compile & Submit ',
        h('span', { className: 'key' }, '⌘↵')
      )
    )
  );
}

export class CORACaseTabs extends ShellElement {
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

    return CaseTabs({
      types,
      active,
      dirty: isDirty.get(),
      onSelect: (slug) => {
        activeSlug.set(slug);
        setFilters({ category: null });
      },
      onRevert: () => {
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
      onCompile: () => drawerOpen.set(true),
    });
  }
}

customElements.define('cora-case-tabs', CORACaseTabs);
