// @ts-check
import { h } from '../../lib/html.js';

/**
 * @typedef {Object} CaseTabsProps
 * @property {Record<string, { label: string, questions: unknown[] }>} types
 * @property {string} active
 * @property {string[]} dirtySlugs the Case Types carrying uncommitted edits
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
  dirtySlugs,
  onSelect,
  onRevert,
  onCompile,
}) {
  const tabs = h('div', { className: 'case-tabs' });
  const dirty = new Set(dirtySlugs);
  for (const slug in types) {
    const type = types[slug];
    const isDirty = dirty.has(slug);
    tabs.appendChild(
      h(
        'button',
        {
          className: 'case-tab' + (slug === active ? ' active' : ''),
          onclick: () => onSelect(slug),
        },
        type.label,
        h('span', { className: 'tab-count' }, `${type.questions.length} q`),
        // Text, not an aria-label: the marker joins the button's accessible
        // name rather than replacing it, so the count is still announced.
        ...(isDirty
          ? [h('span', { className: 'tab-dirty' }, '● unsynced')]
          : [])
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
