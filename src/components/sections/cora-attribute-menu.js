// @ts-check
import { h } from '../../lib/html.js';
import { PeoplePicker } from '../base/cora-people-picker.js';

/** @typedef {import('../../sharepoint-client.js').PersonResult} PersonResult */
/** @typedef {{ loginName: string, displayName: string }} Party */

/**
 * Inline attribution control. Rendered directly under a failed
 * Answer's remediation, it is always visible — no button to disclose it, no
 * floating popover. Unset, it offers a one-click quick-pick of the Case's
 * Responsible Party (the common case) alongside `PeoplePicker` for
 * everyone else. Once set, it collapses to the attributed person's name plus a
 * clear button; clearing re-reveals the pickers so the reviewer can re-attribute.
 *
 * Owns no state of its own: the Case Review route supplies query/results and
 * handles input, selection, and clearing before re-rendering this control.
 *
 * @param {{
 * attributedParty?: Party | null,
 * responsibleParty?: Party | null,
 * query?: string,
 * people?: PersonResult[],
 * onInput?: (value: string) => void,
 * onSelect?: (party: Party) => void,
 * onClear?: () => void,
 * }} props
 * @returns {HTMLElement}
 */
export function AttributeMenu({
  attributedParty = null,
  responsibleParty = null,
  query = '',
  people = [],
  onInput = () => {},
  onSelect = () => {},
  onClear = () => {},
}) {
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
            onclick: onClear,
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
            onclick: () => onSelect(rp),
          },
          `Responsible Party — ${rp.displayName}`
        )
      );
    }

    const picker = PeoplePicker({
      placeholder: 'Search people…',
      people,
      query,
      inputValue: query,
      onInput,
      onSelect,
    });
    children.push(...picker);
  }

  return h('div', { className: 'cora-attribute-menu' }, ...children);
}
