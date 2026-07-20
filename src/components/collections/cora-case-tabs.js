// @ts-check
import { h } from '../../lib/html.js';

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
