// @ts-check
import { h } from '../../lib/html.js';

/**
 * @typedef {object} Tab
 * @property {string} id Stable identifier for the tab and its panel.
 * @property {string} label Visible text on the tab button.
 * @property {boolean} [hidden] When true, the tab renders neither a button nor a panel.
 */

/**
 * @typedef {Object} TabsProps
 * @property {Tab[]} tabs
 * @property {Record<string, Node>} panels
 * @property {string} selected
 * @property {string} uid
 * @property {string} focusId
 * @property {(id: string) => void} onSelect
 * @property {(event: KeyboardEvent) => void} onKeydown
 * @property {(node: HTMLElement | null) => void} onFocusTarget
 */

/**
 * @param {Tab[]} tabs
 * @returns {Tab[]}
 */
export function visibleTabs(tabs) {
  return tabs.filter((tab) => !tab.hidden);
}

/**
 * @param {Tab[]} tabs
 * @param {string} selected
 * @returns {string}
 */
export function activeTabId(tabs, selected) {
  const visible = visibleTabs(tabs);
  if (visible.some((tab) => tab.id === selected)) return selected;
  return visible.length ? visible[0].id : '';
}

/**
 * Pure keyboard action used by tab-owning stores.
 * @param {Tab[]} tabs
 * @param {string} selected
 * @param {string} key
 * @returns {string}
 */
export function nextTabId(tabs, selected, key) {
  const step = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
  const visible = visibleTabs(tabs);
  const active = activeTabId(tabs, selected);
  if (!step || visible.length === 0) return active;
  const current = visible.findIndex((tab) => tab.id === active);
  return visible[(current + step + visible.length) % visible.length].id;
}

/**
 * @param {TabsProps} props
 * @returns {Node[]}
 */
export function Tabs({
  tabs,
  panels,
  selected,
  uid,
  focusId,
  onSelect,
  onKeydown,
  onFocusTarget,
}) {
  const activeId = activeTabId(tabs, selected);
  const visible = visibleTabs(tabs);

  /** @type {HTMLElement[]} */
  const panelNodes = [];
  /** @type {HTMLElement | null} */
  let focusTarget = null;

  const tablist = h(
    'div',
    { role: 'tablist', className: 'cora-tabs-list' },
    ...visible.map((tab) => {
      const isSelected = tab.id === activeId;
      const tabId = `${uid}-tab-${tab.id}`;
      const panelId = `${uid}-panel-${tab.id}`;

      const btn = h(
        'button',
        {
          className: 'cora-tabs-tab',
          type: 'button',
          role: 'tab',
          id: tabId,
          'aria-controls': panelId,
          'aria-selected': String(isSelected),
          tabindex: isSelected ? '0' : '-1',
          onclick: () => onSelect(tab.id),
          onkeydown: onKeydown,
        },
        tab.label
      );

      const panel = h('div', {
        className: 'cora-tabs-panel',
        role: 'tabpanel',
        id: panelId,
        'aria-labelledby': tabId,
        tabindex: '0',
      });
      panel.hidden = !isSelected;

      const content = panels[tab.id];
      if (content) panel.appendChild(content);
      panelNodes.push(panel);

      if (focusId === tab.id) focusTarget = btn;

      return btn;
    })
  );

  onFocusTarget(focusTarget);
  return [tablist, ...panelNodes];
}

/**
 * Generic, domain-free pure tab-navigation view.
 *
 * Given a list of `{ id, label, hidden }` tabs and a selected id it renders an
 * ARIA-correct tablist plus the active panel. The owning store supplies click
 * and keyboard actions; `nextTabId()` provides its pure arrow-key transition.
 *
 * It holds NO knowledge of Cases, Sections, or any other domain concept — the
 * consumer supplies the tab metadata and (optionally) panel content nodes via
 * the `panels` map keyed by tab id.
 *
 * @example
 * Tabs({
 *   tabs: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }],
 *   panels: { one: nodeA, two: nodeB },
 *   selected: state.selected,
 *   uid: 'case-sections',
 *   focusId: state.focusId,
 *   onSelect: id => dispatch({ type: 'tabs/select', id }),
 *   onKeydown: event => dispatch({ type: 'tabs/key', key: event.key }),
 *   onFocusTarget: node => node?.focus(),
 * });
 */
