// @ts-check
import { CRElement } from './cr-element.js';

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
export class CRTabs extends CRElement {
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

  connectedCallback() {
    this.render();
  }

  /** @returns {Tab[]} the visible (non-hidden) tabs, in declared order. */
  _visible() {
    return this.tabs.filter(t => !t.hidden);
  }

  /**
   * The id that is effectively selected: the requested one if it maps to a
   * visible tab, otherwise the first visible tab (or '' when none are visible).
   * @returns {string}
   */
  _activeId() {
    const visible = this._visible();
    if (visible.some(t => t.id === this.selected)) return this.selected;
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
    this.dispatchEvent(new CustomEvent('cr-tab-change', { detail: { id }, bubbles: true }));
    this.render();
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
    const current = visible.findIndex(t => t.id === this._activeId());
    const next = (current + step + visible.length) % visible.length;
    this._select(visible[next].id, true);
  }

  render() {
    const activeId = this._activeId();
    const visible = this._visible();

    const tablist = document.createElement('div');
    tablist.setAttribute('role', 'tablist');
    tablist.className = 'cr-tabs-list';

    /** @type {HTMLElement[]} */
    const panelNodes = [];
    /** @type {HTMLElement | null} */
    let focusTarget = null;

    for (const tab of visible) {
      const isSelected = tab.id === activeId;
      const tabId = `${this._uid}-tab-${tab.id}`;
      const panelId = `${this._uid}-panel-${tab.id}`;

      const btn = document.createElement('button');
      btn.className = 'cr-tabs-tab';
      btn.textContent = tab.label;
      btn.setAttribute('type', 'button');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('id', tabId);
      btn.setAttribute('aria-controls', panelId);
      btn.setAttribute('aria-selected', String(isSelected));
      btn.setAttribute('tabindex', isSelected ? '0' : '-1');
      btn.addEventListener('click', () => this._select(tab.id));
      btn.addEventListener('keydown', e => this._onKeydown(/** @type {KeyboardEvent} */ (e)));
      tablist.appendChild(btn);

      const panel = document.createElement('div');
      panel.className = 'cr-tabs-panel';
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('id', panelId);
      panel.setAttribute('aria-labelledby', tabId);
      panel.hidden = !isSelected;
      panel.setAttribute('tabindex', '0');
      const content = this.panels[tab.id];
      if (content) panel.appendChild(content);
      panelNodes.push(panel);

      if (this._focusId === tab.id) focusTarget = btn;
    }

    this.replaceChildren(tablist, ...panelNodes);

    if (focusTarget) focusTarget.focus();
    this._focusId = '';
  }
}

customElements.define('cr-tabs', CRTabs);
