// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState, LoadingState } from '../../lib/empty-state.js';

/** @typedef {import('../../sharepoint-client.js').PersonResult} PersonResult */
/** @typedef {import('../../lib/people-search.js').PeopleSearchStatus} PeopleSearchStatus */

/**
 * @typedef {object} PeoplePickerProps
 * @property {string} placeholder
 * @property {PersonResult[]} people
 * @property {PeopleSearchStatus} status How far the search behind `people` got.
 * @property {string} inputValue
 * @property {(value: string) => void} onQueryInput
 * @property {(person: { loginName: string, displayName: string }) => void} onSelect
 * @property {string} [ariaLabel] The control's accessible name. Defaults to a
 *   generic one, which suits a picker whose surroundings already say what it
 *   fills; a caller supplies its own when the name has to carry that itself.
 */

/**
 * What the picker says beneath the box: whether the directory is still being
 * asked, answered with nothing, or could not be reached at all. The element is
 * always present so its reserved line does not shift the controls below it.
 *
 * @param {PeoplePickerProps} props
 * @returns {HTMLElement}
 */
function peoplePickerStatus(props) {
  const className = 'cora-people-picker-status';
  if (props.status === 'loading') {
    return LoadingState('Searching', { className });
  }
  if (props.status === 'error') {
    return EmptyState('Directory search is unavailable', {
      className,
    });
  }
  if (props.status === 'success' && props.people.length === 0) {
    return EmptyState('No matches', { className });
  }
  return h('p', {
    className,
    'aria-hidden': 'true',
  });
}

/**
 * The input and its dropdown are one control, so they come back as one node:
 * `.cora-people-picker` is `position: relative` and is therefore the containing
 * block the absolutely positioned results list resolves against. Returning a
 * loose pair let that containing block go missing whenever the caller spread
 * them into a statically positioned parent.
 *
 * The options are the directory's matches and nothing else: a person is chosen
 * from the directory or not at all. Offering the typed text as an account
 * produced a value nothing had resolved — indistinguishable, once stored, from
 * a real one — and it appeared precisely when the directory had answered with
 * nothing, including while a search was still in flight or had failed outright.
 *
 * @param {PeoplePickerProps} props
 * @returns {HTMLElement}
 */
export function PeoplePicker(props) {
  const items = props.people.map((p) =>
    peoplePickerOption(
      { loginName: p.loginName, displayName: p.displayName },
      `${p.displayName} — ${p.loginName}`,
      props.onSelect
    )
  );

  const inputEl = h('input', {
    className: 'cora-people-picker-input',
    type: 'text',
    role: 'combobox',
    'aria-label': props.ariaLabel ?? 'Search people',
    placeholder: props.placeholder,
    value: props.inputValue,
    oninput: (/** @type {any} */ ev) => {
      props.onQueryInput(ev.target?.value ?? '');
    },
  });

  const resultsEl = h(
    'ul',
    {
      className: 'cora-people-picker-results',
      role: 'listbox',
      hidden: items.length === 0,
    },
    ...items
  );

  const statusEl = peoplePickerStatus(props);

  return h(
    'div',
    { className: 'cora-people-picker' },
    inputEl,
    resultsEl,
    statusEl
  );
}

/**
 * @param {{ loginName: string, displayName: string }} person
 * @param {string} label
 * @param {(person: { loginName: string, displayName: string }) => void} onSelect
 * @returns {HTMLElement}
 */
function peoplePickerOption(person, label, onSelect) {
  return h(
    'li',
    {
      className: 'cora-people-picker-option',
      role: 'option',
      onclick: () => onSelect(person),
    },
    label
  );
}
