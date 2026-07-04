// @ts-check
import { signal } from '../../lib/signal.js';
import { reactive, on } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import '../base/cora-people-picker.js';

/** @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {{ loginName: string, displayName: string }} Party */

/**
 * Compact, icon-triggered attribution control (ADR-0013). Collapsed, it shows a
 * single "Attribute" button (unset) or a chip with the attributed person's name
 * plus a clear button (set). Opening it reveals a popover offering a one-click
 * quick-pick of the Case's Responsible Party — the common case — alongside the
 * `cora-people-picker` for everyone else.
 *
 * Owns no state of its own beyond open/closed: choosing a person or clearing
 * invokes `onChange` with the new party (or `null`). The caller
 * (cora-remediation-section) is responsible for persistence so the answers signal
 * stays the single source of truth.
 *
 * @param {{
 *   client?: SharePointClient | null,
 *   attributedParty?: Party | null,
 *   responsibleParty?: Party | null,
 *   onChange?: (party: Party | null) => void,
 * }} props
 * @returns {HTMLElement}
 */
export function AttributeMenu({
  client = null,
  attributedParty = null,
  responsibleParty = null,
  onChange,
}) {
  const open = signal(false);

  /** @param {Party | null} party */
  const select = (party) => {
    open.set(false);
    onChange?.(party);
  };

  /** @type {HTMLElement} */
  const host = reactive(() => {
    if (
      typeof document !== 'undefined' &&
      typeof document.addEventListener === 'function'
    ) {
      on(document, 'keydown', (/** @type {any} */ e) => {
        if (e.key === 'Escape' && open.get()) open.set(false);
      });
      on(document, 'mousedown', (/** @type {any} */ e) => {
        if (!open.get()) return;
        if (typeof host.contains === 'function' && host.contains(e.target)) {
          return;
        }
        open.set(false);
      });
    }
    return renderMenu();
  });

  /** @returns {Node[]} */
  function renderMenu() {
    /** @type {Node[]} */
    const children = [];

    if (attributedParty) {
      children.push(
        h(
          'button',
          {
            className: 'cora-attribute-chip',
            type: 'button',
            'aria-haspopup': 'true',
            'aria-expanded': String(open.get()),
            onClick: () => open.set(!open.get()),
          },
          attributedParty.displayName
        )
      );

      children.push(
        h(
          'button',
          {
            className: 'cora-attribute-clear',
            type: 'button',
            'aria-label': 'Clear attribution',
            onClick: () => select(null),
          },
          '✕'
        )
      );
    } else {
      children.push(
        h(
          'button',
          {
            className: 'cora-attribute-trigger',
            type: 'button',
            'aria-haspopup': 'true',
            'aria-expanded': String(open.get()),
            onClick: () => open.set(!open.get()),
          },
          'Attribute'
        )
      );
    }

    children.push(renderPopover());
    return children;
  }

  /** @returns {HTMLElement} */
  function renderPopover() {
    /** @type {Node[]} */
    const children = [];
    children.push(
      h(
        'p',
        { className: 'cora-attribute-popover-title' },
        'Attribute failure to'
      )
    );

    if (responsibleParty) {
      const rp = responsibleParty;
      children.push(
        h(
          'button',
          {
            className: 'cora-attribute-responsible',
            type: 'button',
            onClick: () => select(rp),
          },
          `Responsible Party — ${rp.displayName}`
        )
      );
    }

    const picker = h('cora-people-picker');
    const p = /** @type {any} */ (picker);
    p.client = client;
    p.addEventListener(
      'cora-person-selected',
      (/** @type {CustomEvent<Party>} */ ev) => {
        const detail = /** @type {CustomEvent<Party>} */ (ev).detail;
        select({
          loginName: detail.loginName,
          displayName: detail.displayName,
        });
      }
    );
    children.push(picker);

    return h(
      'div',
      {
        className: 'cora-attribute-popover',
        role: 'dialog',
        hidden: !open.get(),
      },
      children
    );
  }

  return host;
}
