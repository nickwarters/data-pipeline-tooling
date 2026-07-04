// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';

/**
 * @typedef {object} Tab
 * @property {string} id       Stable identifier for the tab and its panel.
 * @property {string} label    Visible text on the tab button.
 * @property {boolean} [hidden] When true, the tab renders neither a button nor a panel.
 */

let uid = 0;

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
    { role: 'tablist', class: 'cora-tabs-list' },
    ...visible.map((tab) => {
      const isSelected = tab.id === activeId;
      const tabId = `${uid}-tab-${tab.id}`;
      const panelId = `${uid}-panel-${tab.id}`;

      const btn = h(
        'button',
        {
          class: 'cora-tabs-tab',
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
        class: 'cora-tabs-panel',
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
 * Generic, domain-free tab-navigation primitive.
 *
 * Given a list of `{ id, label, hidden }` tabs and a selected id it renders an
 * ARIA-correct tablist plus the active panel, owns left/right arrow-key
 * navigation between visible tabs, and emits a bubbling `cora-tab-change` event
 * carrying the newly-selected tab id on change.
 *
 * It holds NO knowledge of Cases, Sections, or any other domain concept — the
 * consumer supplies the tab metadata and (optionally) panel content nodes via
 * the `panels` map keyed by tab id.
 *
 * @example
 *   const tabs = document.createElement('cora-tabs');
 *   tabs.tabs = [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }];
 *   tabs.panels = { one: nodeA, two: nodeB };
 *   tabs.selected = 'one';
 *   tabs.addEventListener('cora-tab-change', e => console.log(e.detail.id));
 */
export class CORATabs extends ShellElement {
  constructor() {
    super();
    /** @type {Tab[]} */
    this.tabs = [];
    /** @type {Record<string, Node>} */
    this.panels = {};
    /** @type {string} */
    this.selected = '';
    /** Unique suffix so multiple cora-tabs instances produce distinct DOM ids. */
    this._uid = `cora-tabs-${uid++}`;
    /** Set to the tab id that should receive focus on the next render. */
    this._focusId = '';
    /** @type {HTMLElement | null} */
    this._focusNode = null;
  }

  /** @returns {Tab[]} the visible (non-hidden) tabs, in declared order. */
  _visible() {
    return visibleTabs(this.tabs);
  }

  /**
   * The id that is effectively selected: the requested one if it maps to a
   * visible tab, otherwise the first visible tab (or '' when none are visible).
   * @returns {string}
   */
  _activeId() {
    return activeTabId(this.tabs, this.selected);
  }

  /**
   * Select a tab by id, emitting `cora-tab-change` and re-rendering when the
   * selection actually changes.
   * @param {string} id
   * @param {boolean} [focus] move focus to the newly-selected tab after render
   */
  _select(id, focus = false) {
    if (id === this._activeId()) return;
    this.selected = id;
    if (focus) this._focusId = id;
    this.dispatchEvent(
      new CustomEvent('cora-tab-change', { detail: { id }, bubbles: true })
    );
    // Force re-render and replace children manually because tabs/selected are not signals
    if (this._viewDisconnect) {
      const tree = this.render();
      this.replaceChildren(...(Array.isArray(tree) ? tree : [tree]));
      if (this._focusNode) {
        this._focusNode.focus();
        this._focusNode = null;
      }
    }
  }

  /**
   * Left/right arrow navigation across visible tabs, wrapping at the ends.
   * @param {KeyboardEvent} e
   */
  _onKeydown(e) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    const visible = this._visible();
    if (visible.length === 0) return;
    e.preventDefault();
    const current = visible.findIndex((t) => t.id === this._activeId());
    const next = (current + step + visible.length) % visible.length;
    this._select(visible[next].id, true);
  }

  render() {
    const focusId = this._focusId;
    this._focusId = '';
    return Tabs({
      tabs: this.tabs,
      panels: this.panels,
      selected: this.selected,
      uid: this._uid,
      focusId,
      onSelect: (id) => this._select(id),
      onKeydown: (event) => this._onKeydown(event),
      onFocusTarget: (node) => {
        this._focusNode = node;
      },
    });
  }
}

customElements.define('cora-tabs', CORATabs);
