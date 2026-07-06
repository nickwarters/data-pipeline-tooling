// @ts-check
import { h } from '../../lib/html.js';
import '../base/cora-people-picker.js';

/** @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {{ loginName: string, displayName: string }} Party */

/**
 * Inline attribution control (ADR-0013). Rendered directly under a failed
 * Answer's remediation, it is always visible — no button to disclose it, no
 * floating popover. Unset, it offers a one-click quick-pick of the Case's
 * Responsible Party (the common case) alongside the `cora-people-picker` for
 * everyone else. Once set, it collapses to the attributed person's name plus a
 * clear button; clearing re-reveals the pickers so the reviewer can re-attribute.
 *
 * Owns no state of its own: choosing a person or clearing invokes `onChange`
 * with the new party (or `null`). The caller (cora-remediation-section) persists
 * the change and re-renders this control, so the answers signal stays the single
 * source of truth.
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
  /** @param {Party | null} party */
  const select = (party) => onChange?.(party);

  /** @type {Node[]} */
  const children = [
    h('p', { className: 'cora-attribute-title' }, 'Attribute failure to'),
  ];

  if (attributedParty) {
    children.push(
      h(
        'div',
        { className: 'cora-attribute-selected' },
        h(
          'span',
          { className: 'cora-attribute-current' },
          attributedParty.displayName
        ),
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
      )
    );
  } else {
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
  }

  return h('cora-attribute-menu', {}, ...children);
}
