// @ts-check
import { ShellElement } from '../../lib/view.js';
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

/**
 * Case Type tab bar shell. State arrives as **signals** passed as properties
 * (`cases`, `active`, `dirty`) — the render effect subscribes to whatever it
 * is given, so fine-grained reactivity is unchanged — and interactions flow
 * up through the `onSelect` / `onRevert` / `onCompile` callbacks supplied by
 * the mounting page. No store dependency.
 */
export class CORACaseTabs extends ShellElement {
  constructor() {
    super();
    /** @type {{ get(): Record<string, any> } | null} */
    this.cases = null;
    /** @type {{ get(): string } | null} */
    this.active = null;
    /** @type {{ get(): boolean } | null} */
    this.dirty = null;
    /** @type {(slug: string) => void} */
    this.onSelect = () => {};
    /** @type {() => void} */
    this.onRevert = () => {};
    /** @type {() => void} */
    this.onCompile = () => {};
  }

  render() {
    return CaseTabs({
      types: this.cases?.get() ?? {},
      active: this.active?.get() ?? '',
      dirty: this.dirty?.get() ?? false,
      onSelect: this.onSelect,
      onRevert: this.onRevert,
      onCompile: this.onCompile,
    });
  }
}

customElements.define('cora-case-tabs', CORACaseTabs);
