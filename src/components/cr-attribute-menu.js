// @ts-check
import { ShellElement } from '../lib/view.js';
import { h } from '../lib/html.js';
import './cr-people-picker.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {{ loginName: string, displayName: string }} Party */

/**
 * Compact, icon-triggered attribution control (ADR-0013). Collapsed, it shows a
 * single "Attribute" button (unset) or a chip with the attributed person's name
 * plus a clear button (set). Opening it reveals a popover offering a one-click
 * quick-pick of the Case's Responsible Party — the common case — alongside the
 * `cr-people-picker` for everyone else.
 *
 * Owns no state of its own beyond open/closed: choosing a person or clearing
 * emits a non-bubbling `cr-attribute-change` with the new party (or `null`).
 * The host (cr-remediation-section) is responsible for persistence so the
 * answers signal stays the single source of truth — hence the event does not
 * bubble, leaving the host to re-dispatch with the relevant question id.
 */
// TODO(simplify-ui): Convert this class-backed custom element to the simpler
// function-component model. The target shape is a plain function returning h()
// nodes, wrapped in reactive() only when local signals need to re-render; keep
// custom elements only for route or browser-integration shells.
export class CRAttributeMenu extends ShellElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} Backs the embedded people picker. */
    this.client = null;
    /** @type {Party | null} The currently attributed person, if any. */
    this.attributedParty = null;
    /** @type {Party | null} The Case's Responsible Party, offered as a quick-pick. */
    this.responsibleParty = null;
    /** @type {boolean} */
    this._open = false;
    /** @type {((e: any) => void) | null} */
    this._onKeydown = null;
    /** @type {((e: any) => void) | null} */
    this._onPointerDown = null;
  }

  connectedCallback() {
    this._onKeydown = (e) => this._handleKeydown(e);
    this._onPointerDown = (e) => this._handlePointerDown(e);
    if (
      typeof document !== 'undefined' &&
      typeof document.addEventListener === 'function'
    ) {
      document.addEventListener('keydown', this._onKeydown);
      document.addEventListener('mousedown', this._onPointerDown);
    }
    super.connectedCallback();
  }

  disconnectedCallback() {
    if (
      typeof document !== 'undefined' &&
      typeof document.removeEventListener === 'function'
    ) {
      if (this._onKeydown)
        document.removeEventListener('keydown', this._onKeydown);
      if (this._onPointerDown)
        document.removeEventListener('mousedown', this._onPointerDown);
    }
    this._onKeydown = null;
    this._onPointerDown = null;
    super.disconnectedCallback();
  }

  /** @param {{ key: string }} e */
  _handleKeydown(e) {
    if (e.key === 'Escape' && this._open) {
      this._close();
    }
  }

  /** @param {{ target: any }} e */
  _handlePointerDown(e) {
    if (!this._open) return;
    if (this.contains(e.target)) return;
    this._close();
  }

  _toggle() {
    this._open = !this._open;
    this._render();
  }

  _close() {
    this._open = false;
    this._render();
  }

  /** @param {Party | null} party */
  _select(party) {
    this._open = false;
    this.dispatchEvent(
      new CustomEvent('cr-attribute-change', {
        detail: { attributedParty: party },
      })
    );
    this._render();
  }

  _render() {
    const content = this.render();
    if (content) {
      if (Array.isArray(content)) {
        this.replaceChildren(...content);
      } else {
        this.replaceChildren(content);
      }
    } else {
      this.replaceChildren();
    }
  }

  render() {
    const children = [];

    if (this.attributedParty) {
      children.push(
        h(
          'button',
          {
            className: 'cr-attribute-chip',
            type: 'button',
            'aria-haspopup': 'true',
            'aria-expanded': String(this._open),
            onClick: () => this._toggle(),
          },
          this.attributedParty.displayName
        )
      );

      children.push(
        h(
          'button',
          {
            className: 'cr-attribute-clear',
            type: 'button',
            'aria-label': 'Clear attribution',
            onClick: () => this._select(null),
          },
          '✕'
        )
      );
    } else {
      children.push(
        h(
          'button',
          {
            className: 'cr-attribute-trigger',
            type: 'button',
            'aria-haspopup': 'true',
            'aria-expanded': String(this._open),
            onClick: () => this._toggle(),
          },
          'Attribute'
        )
      );
    }

    children.push(this._renderPopover());
    return children;
  }

  /** @returns {HTMLElement} */
  _renderPopover() {
    const children = [];
    children.push(
      h(
        'p',
        { className: 'cr-attribute-popover-title' },
        'Attribute failure to'
      )
    );

    if (this.responsibleParty) {
      const rp = this.responsibleParty;
      children.push(
        h(
          'button',
          {
            className: 'cr-attribute-responsible',
            type: 'button',
            onClick: () => this._select(rp),
          },
          `Responsible Party — ${rp.displayName}`
        )
      );
    }

    const picker = h('cr-people-picker');
    const p = /** @type {any} */ (picker);
    p.client = this.client;
    p.addEventListener(
      'cr-person-selected',
      (/** @type {CustomEvent<Party>} */ ev) => {
        const detail = /** @type {CustomEvent<Party>} */ (ev).detail;
        this._select({
          loginName: detail.loginName,
          displayName: detail.displayName,
        });
      }
    );
    children.push(picker);

    return h(
      'div',
      {
        className: 'cr-attribute-popover',
        role: 'dialog',
        hidden: !this._open,
      },
      children
    );
  }
}

customElements.define('cr-attribute-menu', CRAttributeMenu);
