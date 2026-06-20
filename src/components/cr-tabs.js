// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';

/**
 * @typedef {object} Tab
 * @property {string} id       Stable identifier for the tab and its panel.
 * @property {string} label    Visible text on the tab button.
 * @property {boolean} [hidden] When true, the tab renders neither a button nor a panel.
 */

let uid = 0;

/**
 * Generic, domain-free tab-navigation primitive.
 *
 * Given a list of `{ id, label, hidden }` tabs and a selected id it renders an
 * ARIA-correct tablist plus the active panel, owns left/right arrow-key
 * navigation between visible tabs, and emits a bubbling `cr-tab-change` event
 * carrying the newly-selected tab id on change.
 *
 * It holds NO knowledge of Cases, Sections, or any other domain concept — the
 * consumer supplies the tab metadata and (optionally) panel content nodes via
 * the `panels` map keyed by tab id.
 *
 * @example
 *   const tabs = document.createElement('cr-tabs');
 *   tabs.tabs = [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }];
 *   tabs.panels = { one: nodeA, two: nodeB };
 *   tabs.selected = 'one';
 *   tabs.addEventListener('cr-tab-change', e => console.log(e.detail.id));
 */
export class CRTabs extends ReactiveElement {
  constructor() {
    super();
    /** @type {Tab[]} */
    this.tabs = [];
    /** @type {Record<string, Node>} */
    this.panels = {};
    /** @type {string} */
    this.selected = '';
    /** Unique suffix so multiple cr-tabs instances produce distinct DOM ids. */
    this._uid = `cr-tabs-${uid++}`;
    /** Set to the tab id that should receive focus on the next render. */
    this._focusId = '';
  }

  /** @returns {Tab[]} the visible (non-hidden) tabs, in declared order. */
  _visible() {
    return this.tabs.filter((t) => !t.hidden);
  }

  /**
   * The id that is effectively selected: the requested one if it maps to a
   * visible tab, otherwise the first visible tab (or '' when none are visible).
   * @returns {string}
   */
  _activeId() {
    const visible = this._visible();
    if (visible.some((t) => t.id === this.selected)) return this.selected;
    return visible.length ? visible[0].id : '';
  }

  /**
   * Select a tab by id, emitting `cr-tab-change` and re-rendering when the
   * selection actually changes.
   * @param {string} id
   * @param {boolean} [focus] move focus to the newly-selected tab after render
   */
  _select(id, focus = false) {
    if (id === this._activeId()) return;
    this.selected = id;
    if (focus) this._focusId = id;
    this.dispatchEvent(
      new CustomEvent('cr-tab-change', { detail: { id }, bubbles: true })
    );
    // Force re-render and replace children manually because tabs/selected are not signals
    if (this._renderDispose) {
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
    const activeId = this._activeId();
    const visible = this._visible();

    /** @type {HTMLElement[]} */
    const panelNodes = [];
    /** @type {HTMLElement | null} */
    let focusTarget = null;

    const tablist = h(
      'div',
      { role: 'tablist', class: 'cr-tabs-list' },
      ...visible.map((tab) => {
        const isSelected = tab.id === activeId;
        const tabId = `${this._uid}-tab-${tab.id}`;
        const panelId = `${this._uid}-panel-${tab.id}`;

        const btn = h(
          'button',
          {
            class: 'cr-tabs-tab',
            type: 'button',
            role: 'tab',
            id: tabId,
            'aria-controls': panelId,
            'aria-selected': String(isSelected),
            tabindex: isSelected ? '0' : '-1',
            onclick: () => this._select(tab.id),
            onkeydown: (/** @type {KeyboardEvent} */ e) => this._onKeydown(e),
          },
          tab.label
        );

        const panel = h('div', {
          class: 'cr-tabs-panel',
          role: 'tabpanel',
          id: panelId,
          'aria-labelledby': tabId,
          tabindex: '0',
        });
        panel.hidden = !isSelected;

        const content = this.panels[tab.id];
        if (content) panel.appendChild(content);
        panelNodes.push(panel);

        if (this._focusId === tab.id) focusTarget = btn;

        return btn;
      })
    );

    this._focusNode = focusTarget;
    this._focusId = '';

    return [tablist, ...panelNodes];
  }
}

customElements.define('cr-tabs', CRTabs);
